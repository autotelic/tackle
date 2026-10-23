import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { markerOf, type Job } from "@autotelic/board"
import { Result, Schema } from "effect"
import type { RoomConfig } from "./config.ts"
import { hasReviewMarker, postReview, pullRequest, type PullRequest } from "./gh.ts"
import { addWorktree, fetchCommit, removeWorktree } from "./git.ts"
import { jobsRoot, worktreeRoot } from "./paths.ts"
import { onPath, run } from "./shell.ts"

/*
 * One review job.
 *
 * The order is the contract: a marker check, then a detached worktree, then the machine
 * checks, then the model, then one post. The model never decides whether jig ran, never
 * decides whether the head SHA was already reviewed, and never holds the token — the
 * daemon does all three around it.
 *
 * The worktree is the isolation boundary. A review is read-only by tools, but it needs a
 * real checkout to run jig and to read the tree the PR would produce.
 */

/** What a review job decided. */
export interface ReviewResult {
  readonly ok: boolean
  readonly state: "posted" | "skipped" | "failed"
  readonly note: string
}

const DEFAULT_SKILL = "Review the diff for correctness, data-model mismatches, and missing cases."

/** The standing instructions, read from the package when present. */
const skill = (): string => {
  const file = new URL("../skills/review.md", import.meta.url)
  return existsSync(file) ? readFileSync(file, "utf8") : DEFAULT_SKILL
}

/** One finding a reviewer can act on. */
interface Diagnostic {
  readonly file: string
  readonly line: number
  readonly severity: string
  readonly rule: string
  readonly message: string
}

const JigDiagnostic = Schema.Struct({
  engine: Schema.optionalKey(Schema.String),
  ruleId: Schema.optionalKey(Schema.String),
  severity: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
  location: Schema.optionalKey(
    Schema.Struct({
      file: Schema.String,
      line: Schema.optionalKey(Schema.Finite),
    }),
  ),
})

const JigReport = Schema.Struct({ diagnostics: Schema.Array(JigDiagnostic) })

const PiPart = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
})

const PiEvent = Schema.Struct({
  type: Schema.String,
  message: Schema.optionalKey(
    Schema.Struct({
      role: Schema.optionalKey(Schema.String),
      content: Schema.optionalKey(Schema.Array(PiPart)),
    }),
  ),
})

const jigCommand = () => {
  const override = process.env.ROOM_JIG_BIN
  if (override !== undefined && override !== "") return { command: override, args: [] }
  const global = Result.getOrUndefined(onPath("jig"))
  if (global !== undefined) return { command: global, args: [] }
  const source = new URL("../../jig-cli/src/cli.ts", import.meta.url)
  return { command: process.execPath, args: ["--conditions=development", source.pathname] }
}

const jigFindings = (root: string) => {
  const { command, args } = jigCommand()
  const result = run({
    command,
    args: [...args, "check", "--cwd", root, "--format", "json"],
    cwd: root,
  })
  const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(JigReport))(result.stdout)
  if (Result.isFailure(decoded)) {
    return {
      findings: [] as ReadonlyArray<Diagnostic>,
      note: `jig did not produce a report (exit ${result.code}): ${result.stderr.trim()}`,
    }
  }
  const findings = decoded.success.diagnostics.flatMap((entry): ReadonlyArray<Diagnostic> => {
    if (entry.location === undefined) return []
    return [
      {
        file: entry.location.file,
        line: entry.location.line ?? 0,
        severity: entry.severity ?? "info",
        rule: `${entry.engine ?? "jig"}/${entry.ruleId ?? "unknown"}`,
        message: entry.message ?? "",
      },
    ]
  })
  return { findings, note: "" }
}

/** Keep the findings a reviewer can act on here: the files this PR changed. */
const onChanged = (findings: ReadonlyArray<Diagnostic>, files: ReadonlyArray<string>) => {
  const scope = new Set(files)
  return findings.filter((finding) => scope.has(finding.file))
}

const promptOf = ({
  pr,
  files,
  findings,
  jigNote,
}: {
  readonly pr: PullRequest
  readonly files: ReadonlyArray<string>
  readonly findings: ReadonlyArray<Diagnostic>
  readonly jigNote: string
}): string => {
  const checks =
    findings.length === 0
      ? jigNote === ""
        ? "jig: no findings on the changed files."
        : `jig: ${jigNote}`
      : findings
          .map(
            (finding) =>
              `- [${finding.severity}] ${finding.rule} ${finding.file}:${finding.line} — ${finding.message}`,
          )
          .join("\n")
  return [
    skill(),
    "",
    "## Pull request",
    `#${pr.number} ${pr.title}`,
    "",
    pr.body.slice(0, 8_000),
    "",
    "## Changed files",
    files.map((file) => `- ${file}`).join("\n"),
    "",
    "## Machine checks already run (do not repeat these)",
    checks,
    "",
    "Give blockers only. If you find none, say 'No blockers found.'",
  ].join("\n")
}

const runPi = (args: ReadonlyArray<string>, cwd: string) =>
  new Promise<{ text: string; code: number }>((resolve) => {
    const child = spawn("pi", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60_000)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve({ text: "", code: 127 })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      const texts: Array<string> = []
      for (const line of stdout.split("\n")) {
        const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(PiEvent))(line)
        if (Result.isFailure(decoded)) continue
        const event = decoded.success
        const message = event.message
        if (event.type !== "message" || message === undefined || message.role !== "assistant") {
          continue
        }
        const text = (message.content ?? []).flatMap((part) =>
          part.type === "text" && part.text !== undefined ? [part.text] : [],
        )
        if (text.join("").trim() !== "") texts.push(text.join(""))
      }
      resolve({ text: texts.at(-1)?.trim() ?? stderr.trim(), code: code ?? 1 })
    })
  })

const bodyOf = ({
  room,
  sha,
  findings,
  jigNote,
  review,
}: {
  readonly room: string
  readonly sha: string
  readonly findings: ReadonlyArray<Diagnostic>
  readonly jigNote: string
  readonly review: string
}): string => {
  const checks =
    findings.length === 0
      ? jigNote === ""
        ? "No findings on the changed files."
        : jigNote
      : findings
          .map(
            (finding) =>
              `- \`${finding.file}:${finding.line}\` — **${finding.severity}** ${finding.rule}: ${finding.message}`,
          )
          .join("\n")
  return [
    markerOf({ room, sha }),
    "> **Agent review** — posted by a bot, not a human. Treat it as a first pass; a person still owns the merge.",
    "",
    "### Machine checks",
    checks,
    "",
    "### Review",
    review === "" ? "No blockers found." : review,
  ].join("\n")
}

/**
 * Run one review job: read the PR, prepare a worktree, run jig, ask Pi, post once.
 *
 * @param input - The room config, the job, whether to stop before Pi, and a logger.
 * @returns What the job decided and the one line a person should read.
 */
export const runReview = async ({
  config,
  job,
  dryRun,
  log,
}: {
  readonly config: RoomConfig
  readonly job: Job
  readonly dryRun: boolean
  readonly log: (line: string) => void
}): Promise<ReviewResult> => {
  const pr = Result.getOrUndefined(pullRequest({ number: job.pr, cwd: config.repo.root }))
  if (pr === undefined) return { ok: false, state: "failed", note: `cannot read PR #${job.pr}` }
  if (pr.isDraft) return { ok: true, state: "skipped", note: "draft" }
  const sha = pr.headRefOid === "" ? job.sha : pr.headRefOid
  const marker = markerOf({ room: config.room, sha })
  if (
    hasReviewMarker({
      number: pr.number,
      owner: config.repo.owner,
      name: config.repo.name,
      marker,
      cwd: config.repo.root,
    })
  ) {
    return { ok: true, state: "skipped", note: `already reviewed ${sha.slice(0, 8)}` }
  }

  const dir = join(worktreeRoot(config), `pr-${pr.number}-${sha.slice(0, 8)}`)
  if (existsSync(dir)) removeWorktree({ root: config.repo.root, dir })
  fetchCommit({ root: config.repo.root, sha })
  if (Result.isFailure(addWorktree({ root: config.repo.root, sha, dir }))) {
    return { ok: false, state: "failed", note: `cannot create worktree at ${sha.slice(0, 8)}` }
  }

  // SAFETY: the worktree must be removed even when a step throws. This is cleanup, not
  // control flow; the failure itself still travels to the caller as a ReviewResult.
  try {
    if (!existsSync(join(dir, "node_modules")) && existsSync(join(dir, "pnpm-lock.yaml"))) {
      log(`install ${dir}`)
      const install = run({
        command: "pnpm",
        args: ["install", "--frozen-lockfile", "--prefer-offline"],
        cwd: dir,
      })
      if (install.code !== 0) log(`install failed: ${install.stderr.trim()}`)
    }

    const jig = jigFindings(dir)
    const findings = onChanged(jig.findings, pr.files)
    const prompt = promptOf({ pr, files: pr.files, findings, jigNote: jig.note })
    const model = `${config.review.provider}/${config.review.model}`

    if (dryRun) {
      log(
        `pi -p --mode json --provider ${config.review.provider} --model ${config.review.model} (cwd ${dir})`,
      )
      log(prompt.slice(0, 1_200))
      return { ok: true, state: "skipped", note: "dry run" }
    }

    const sessionDir = join(jobsRoot(config), `pr-${pr.number}-${sha.slice(0, 8)}`)
    const answer = await runPi(
      [
        "-p",
        "--mode",
        "json",
        "--provider",
        config.review.provider,
        "--model",
        config.review.model,
        "--session-dir",
        sessionDir,
        "--name",
        `review #${pr.number}`,
        "--tools",
        "read,grep,find,ls,bash",
        prompt,
      ],
      dir,
    )
    if (answer.code !== 0) {
      return {
        ok: false,
        state: "failed",
        note: `pi exited ${answer.code}: ${answer.text.slice(0, 200)}`,
      }
    }

    const body = bodyOf({
      room: config.room,
      sha,
      findings,
      jigNote: jig.note,
      review: answer.text,
    })
    log(`posting review on #${pr.number} (${model})`)
    const posted = postReview({ number: pr.number, body, cwd: config.repo.root })
    return posted.ok
      ? { ok: true, state: "posted", note: `${pr.number} @ ${sha.slice(0, 8)}` }
      : { ok: false, state: "failed", note: posted.message }
  } finally {
    removeWorktree({ root: config.repo.root, dir })
  }
}
