import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { markerOf, type Job } from "@autotelic/board"
import type { RoomConfig } from "./config.ts"
import { hasReviewMarker, postReview, pullRequest } from "./gh.ts"
import { addWorktree, fetchCommit, removeWorktree } from "./git.ts"
import { jobsRoot, worktreeRoot } from "./paths.ts"
import { onPath, parseJson, run } from "./shell.ts"

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

export interface ReviewResult {
  readonly ok: boolean
  readonly state: "posted" | "skipped" | "failed"
  readonly note: string
}

const skill = (): string => {
  try {
    return readFileSync(new URL("../skills/review.md", import.meta.url), "utf8")
  } catch {
    return "Review the diff for correctness, data-model mismatches, and missing cases."
  }
}

interface Diagnostic {
  readonly file: string
  readonly line: number
  readonly severity: string
  readonly rule: string
  readonly message: string
}

const jigCommand = (): { readonly command: string; readonly args: ReadonlyArray<string> } => {
  const override = process.env.ROOM_JIG_BIN
  if (override !== undefined && override !== "") return { command: override, args: [] }
  const global = onPath("jig")
  if (global !== undefined) return { command: global, args: [] }
  const source = new URL("../../jig-cli/src/cli.ts", import.meta.url)
  return { command: process.execPath, args: ["--conditions=development", source.pathname] }
}

const jigFindings = (
  root: string,
): { readonly findings: ReadonlyArray<Diagnostic>; readonly note: string } => {
  const { command, args } = jigCommand()
  const result = run({
    command,
    args: [...args, "check", "--cwd", root, "--format", "json"],
    cwd: root,
  })
  const report = parseJson(result.stdout)
  if (typeof report !== "object" || report === null) {
    return {
      findings: [],
      note: `jig did not produce a report (exit ${result.code}): ${result.stderr.trim()}`,
    }
  }
  const diagnostics = (report as { diagnostics?: unknown }).diagnostics
  if (!Array.isArray(diagnostics)) {
    return { findings: [], note: "jig produced a report with no diagnostics array" }
  }
  const findings = diagnostics.flatMap((value): ReadonlyArray<Diagnostic> => {
    if (typeof value !== "object" || value === null) return []
    const entry = value as Record<string, unknown>
    const location = entry.location
    if (typeof location !== "object" || location === null) return []
    const at = location as Record<string, unknown>
    if (typeof at.file !== "string") return []
    return [
      {
        file: at.file,
        line: typeof at.line === "number" ? at.line : 0,
        severity: typeof entry.severity === "string" ? entry.severity : "info",
        rule: `${typeof entry.engine === "string" ? entry.engine : "jig"}/${typeof entry.ruleId === "string" ? entry.ruleId : "unknown"}`,
        message: typeof entry.message === "string" ? entry.message : "",
      },
    ]
  })
  return { findings, note: "" }
}

/** Keep the findings a reviewer can act on here: the files this PR changed. */
const onChanged = (
  findings: ReadonlyArray<Diagnostic>,
  files: ReadonlyArray<string>,
): ReadonlyArray<Diagnostic> => {
  const scope = new Set(files)
  return findings.filter((finding) => scope.has(finding.file))
}

const promptOf = ({
  pr,
  files,
  findings,
  jigNote,
}: {
  readonly pr: NonNullable<ReturnType<typeof pullRequest>>
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

const runPi = (args: ReadonlyArray<string>, cwd: string): Promise<{ text: string; code: number }> =>
  new Promise((resolve) => {
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
        const event = parseJson(line)
        if (typeof event !== "object" || event === null) continue
        const record = event as Record<string, unknown>
        if (record.type !== "message") continue
        const message = record.message
        if (typeof message !== "object" || message === null) continue
        const value = message as Record<string, unknown>
        if (value.role !== "assistant" || !Array.isArray(value.content)) continue
        const text = value.content.flatMap((part) =>
          typeof part === "object" &&
          part !== null &&
          (part as Record<string, unknown>).type === "text"
            ? [
                typeof (part as Record<string, unknown>).text === "string"
                  ? ((part as Record<string, unknown>).text as string)
                  : "",
              ]
            : [],
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
    markerOf(room, sha),
    "> **Agent review** — posted by a bot, not a human. Treat it as a first pass; a person still owns the merge.",
    "",
    "### Machine checks",
    checks,
    "",
    "### Review",
    review === "" ? "No blockers found." : review,
  ].join("\n")
}

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
  const pr = pullRequest(job.pr, config.repo.root)
  if (pr === undefined) return { ok: false, state: "failed", note: `cannot read PR #${job.pr}` }
  if (pr.isDraft) return { ok: true, state: "skipped", note: "draft" }
  const sha = pr.headRefOid === "" ? job.sha : pr.headRefOid
  const marker = markerOf(config.room, sha)
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
  fetchCommit(config.repo.root, sha)
  if (!addWorktree(config.repo.root, sha, dir)) {
    return { ok: false, state: "failed", note: `cannot create worktree at ${sha.slice(0, 8)}` }
  }

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
    const posted = postReview(pr.number, body, config.repo.root)
    return posted.ok
      ? { ok: true, state: "posted", note: `${pr.number} @ ${sha.slice(0, 8)}` }
      : { ok: false, state: "failed", note: posted.message }
  } finally {
    removeWorktree({ root: config.repo.root, dir })
  }
}
