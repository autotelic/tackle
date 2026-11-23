import { Data, Option } from "effect"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import {
  collision,
  listWorkstreams,
  recordOf,
  writeWorkstream,
  type Phase,
  type Workstream,
} from "./store.ts"

/** A failed adoption, with the step that failed and the command's own words. */
export class AdoptError extends Data.TaggedError("AdoptError")<{
  readonly step: string
  readonly detail: string
}> {}

type Outcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: AdoptError }

const ok = <A>(value: A): Outcome<A> => ({ ok: true, value })
const fail = <A>({
  step,
  detail,
}: {
  readonly step: string
  readonly detail: string
}): Outcome<A> => ({
  ok: false,
  error: new AdoptError({ step, detail }),
})

type Run = {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

const run = ({ command, args, cwd, env }: Run) => {
  const result = spawnSync(command, [...args], {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
  })
  if (result.error !== undefined) return { ok: false as const, detail: String(result.error) }
  if (result.status !== 0)
    return { ok: false as const, detail: (result.stderr || result.stdout).trim() }
  return { ok: true as const, stdout: result.stdout }
}

const git = (input: { readonly path: string; readonly args: ReadonlyArray<string> }) =>
  run({ command: "git", args: ["-C", input.path, ...input.args] })

const gitOk = (input: {
  readonly path: string
  readonly args: ReadonlyArray<string>
  readonly step: string
}): Outcome<string> => {
  const result = git(input)
  return result.ok ? ok(result.stdout.trim()) : fail({ step: input.step, detail: result.detail })
}

const ghBin = (): string => process.env.GH_BIN ?? "gh"

const PrView = Schema.Struct({
  number: Schema.Finite,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  baseRefName: Schema.String,
  baseRefOid: Schema.String,
  url: Schema.String,
})

const pullRequest = (input: {
  readonly repo: string
  readonly pr: number
  readonly cwd: string
}): Outcome<typeof PrView.Type> => {
  const result = run({
    command: ghBin(),
    args: [
      "pr",
      "view",
      String(input.pr),
      "--repo",
      input.repo,
      "--json",
      "number,headRefName,headRefOid,baseRefName,baseRefOid,url",
    ],
    cwd: input.cwd,
  })
  if (!result.ok) return fail({ step: "pull request", detail: result.detail })
  const decoded = Schema.decodeResult(Schema.fromJsonString(PrView))(result.stdout)
  return Result.isSuccess(decoded)
    ? ok(decoded.success)
    : fail({ step: "pull request", detail: "the PR response does not decode" })
}

const slugOf = (remote: string): Option.Option<string> => {
  const match = remote.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/u)
  return match === null ? Option.none() : Option.some(match[1] + "/" + match[2])
}

const WIP_INDEX = (): string => join(mkdtempSync(join(tmpdir(), "factory-index-")), "index")

/**
 * Capture the worktree as a WIP commit at refs/bench/<id> without touching its index.
 *
 * @param input - the worktree, workstream id, HEAD and timestamp.
 * @returns the checkpoint, whether the push succeeded, or the failing step.
 */
export const captureCheckpoint = (input: {
  readonly path: string
  readonly id: string
  readonly head: string
  readonly at: string
}): Outcome<Workstream["checkpoint"]> => {
  const status = git({ path: input.path, args: ["status", "--porcelain"] })
  if (!status.ok) return fail({ step: "checkpoint", detail: status.detail })
  const clean = status.stdout.trim() === ""
  const ref = "refs/bench/" + input.id
  let sha = input.head

  if (!clean) {
    const index = WIP_INDEX()
    const env = { ...process.env, GIT_INDEX_FILE: index }
    // SAFETY: the temp index is a local resource; the finally is cleanup, not the error channel.
    try {
      const read = run({ command: "git", args: ["-C", input.path, "read-tree", "HEAD"], env })
      if (!read.ok) return fail({ step: "checkpoint", detail: read.detail })
      const add = run({ command: "git", args: ["-C", input.path, "add", "-A"], env })
      if (!add.ok) return fail({ step: "checkpoint", detail: add.detail })
      const tree = run({ command: "git", args: ["-C", input.path, "write-tree"], env })
      if (!tree.ok) return fail({ step: "checkpoint", detail: tree.detail })
      const commit = run({
        command: "git",
        args: [
          "-C",
          input.path,
          "commit-tree",
          tree.stdout.trim(),
          "-p",
          input.head,
          "-m",
          "factory checkpoint " + input.id + " " + input.at,
        ],
        env,
      })
      if (!commit.ok) return fail({ step: "checkpoint", detail: commit.detail })
      sha = commit.stdout.trim()
    } finally {
      rmSync(index, { force: true })
    }
  }

  const update = git({ path: input.path, args: ["update-ref", ref, sha] })
  if (!update.ok) return fail({ step: "checkpoint", detail: update.detail })
  const push = git({ path: input.path, args: ["push", "origin", ref + ":" + ref] })
  return ok({ sha, ref, at: input.at, pushed: push.ok })
}

export interface AdoptInput {
  readonly path: string
  readonly project: string
  readonly linearProjectId?: string | undefined
  readonly linearUrl?: string | undefined
  readonly label: string
  readonly delivery?: "pr" | "trunk" | undefined
  readonly reports?: string | undefined
  readonly pr: number | undefined
  readonly repo?: string | undefined
  readonly id: string
  readonly phase: Phase
  readonly at: string
  readonly home?: string
}

/** Adopt an existing worktree in place, after recording every refusal. */
export const adopt = async (input: AdoptInput): Promise<Outcome<Workstream>> => {
  const top = gitOk({
    path: input.path,
    args: ["rev-parse", "--show-toplevel"],
    step: "worktree",
  })
  if (!top.ok) return fail({ step: "worktree", detail: top.error.detail })
  const path = resolve(top.value)

  const branch = gitOk({ path, args: ["symbolic-ref", "--short", "HEAD"], step: "branch" })
  if (!branch.ok) return fail({ step: "branch", detail: "detached HEAD has no branch to adopt" })
  const head = gitOk({ path, args: ["rev-parse", "HEAD"], step: "head" })
  if (!head.ok) return head

  const delivery =
    input.delivery ??
    (input.pr === undefined ? (input.reports === undefined ? undefined : "trunk") : "pr")
  if (delivery === undefined)
    return fail({
      step: "delivery",
      detail: "PrRequired: pass --pr or --delivery trunk",
    })

  const remote = git({ path, args: ["remote", "get-url", "origin"] })
  const remoteSlug = remote.ok ? slugOf(remote.stdout) : Option.none<string>()
  const repo = Option.isSome(remoteSlug)
    ? remoteSlug.value
    : (input.repo ?? (delivery === "trunk" ? "local/" + basename(path) : undefined))
  if (repo === undefined)
    return fail({
      step: "remote",
      detail: "PR delivery needs an origin remote; pass --repo for a local trunk",
    })
  if (remote.ok && Option.isNone(remoteSlug) && input.repo === undefined)
    return fail({ step: "remote", detail: "origin is not a GitHub repository: " + remote.stdout })

  let base = branch.value
  let baseSha = head.value
  let prHead = head.value

  if (delivery === "pr") {
    if (input.pr === undefined)
      return fail({ step: "pull request", detail: "PR delivery needs --pr" })
    const pr = pullRequest({ repo, pr: input.pr, cwd: path })
    if (!pr.ok) return pr
    if (pr.value.headRefName !== branch.value)
      return fail({
        step: "pull request",
        detail:
          "PR head " + pr.value.headRefName + " is not the checked-out branch " + branch.value,
      })
    base = pr.value.baseRefName
    baseSha = pr.value.baseRefOid
    prHead = pr.value.headRefOid
  }

  const records = await listWorkstreams({ home: input.home })
  const owner = collision({ records, path, repo, pr: input.pr })
  if (owner._tag === "Owned")
    return fail({
      step: "collision",
      detail:
        "already owned by " +
        owner.workstream.id +
        " (path " +
        owner.workstream.path +
        ", PR " +
        owner.workstream.pr +
        ")",
    })

  const captured = captureCheckpoint({ path, id: input.id, head: head.value, at: input.at })
  if (!captured.ok) return captured

  const record = recordOf({
    id: input.id,
    facts: {
      project: input.project,
      linearProjectId: input.linearProjectId,
      linearUrl: input.linearUrl,
      label: input.label,
      repo,
      path,
      branch: branch.value,
      head: head.value,
      delivery,
      pr: input.pr,
      sources:
        delivery === "trunk"
          ? [
              {
                kind: "reports" as const,
                dir: input.reports === undefined ? "~/.factory/reports" : input.reports,
              },
            ]
          : undefined,
      base,
      baseSha,
      prHead,
      phase: input.phase,
      at: input.at,
      checkpoint: captured.value,
    },
  })
  await writeWorkstream({ record, home: input.home })
  return ok(record)
}
