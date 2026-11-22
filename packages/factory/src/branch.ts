import { spawnSync } from "node:child_process"
import { listWorkstreams, ownerOfPath, type Workstream } from "./store.ts"

/** What git answers when it cannot name a branch; the refusal still has to name both sides. */
const NO_BRANCH = "(no branch: detached HEAD or not a git worktree)"

/**
 * The branch a worktree has checked out, in one git call.
 *
 * `symbolic-ref` asks exactly the guard's question — which branch is HEAD on — where a
 * pass's own `rev-parse` only asks where it points: after a fast-forward the same sha sits
 * on several branches, so the sha cannot answer it. A detached HEAD and a path that is not
 * a repository both answer no branch, and neither can be the branch a record adopted.
 *
 * @param path - the worktree root (a subdirectory answers the same branch).
 * @returns the short branch name, or undefined when git cannot name one.
 */
export const branchOf = (path: string): string | undefined => {
  const result = spawnSync("git", ["-C", path, "symbolic-ref", "--short", "HEAD"], {
    encoding: "utf8",
  })
  if (result.status !== 0) return undefined
  const branch = result.stdout.trim()
  return branch === "" ? undefined : branch
}

export type BranchVerdict =
  | {
      readonly ok: true
      readonly record: Workstream | undefined
      readonly branch: string | undefined
    }
  | { readonly ok: false; readonly record: Workstream; readonly reason: string }

/** The record that owns a worktree path, through the lookup adoption refuses a second owner with. */
const ownerOf = async (input: {
  readonly path: string
  readonly home?: string | undefined
}): Promise<Workstream | undefined> => {
  return ownerOfPath({
    records: await listWorkstreams({ home: input.home }),
    path: input.path,
  })
}

/**
 * The one lookup the kernel and the push hook share, so they cannot disagree.
 *
 * Adoption writes `record.branch` once and nothing re-read it: a hand session can switch
 * HEAD under a worktree between adopt and a pass, and a pass would then commit to a
 * stranger's branch with every other check green. Both callers ask this function, so
 * `factory guard` in a pre-push hook and `factory run` answer alike.
 *
 * A path no record owns is not a refusal: the factory governs workstreams, not the machine.
 *
 * @param input - the worktree path, the record (read from the store when absent), and the home.
 * @returns ok with the observed branch, or the refusal naming both branches.
 */
export const branchGuard = async (input: {
  readonly path: string
  readonly record?: Workstream | undefined
  readonly home?: string | undefined
}): Promise<BranchVerdict> => {
  const owner = input.record ?? (await ownerOf({ path: input.path, home: input.home }))
  if (owner === undefined) return { ok: true, record: undefined, branch: undefined }
  const branch = branchOf(input.path)
  if (branch === owner.branch) return { ok: true, record: owner, branch }
  return {
    ok: false,
    record: owner,
    reason: "BranchMismatch: expected " + owner.branch + ", found " + (branch ?? NO_BRANCH),
  }
}
