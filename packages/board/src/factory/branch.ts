import { spawnSync } from "node:child_process"
import { Data } from "effect"
import * as Option from "effect/Option"
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
 * Kept internal on purpose: the guard's public answer is the tagged verdict below, so no
 * caller can read git's silence as a branch name.
 *
 * @param path - the worktree root (a subdirectory answers the same branch).
 * @returns the short branch name, or none when git cannot name one.
 */
const branchOf = (path: string): Option.Option<string> => {
  const result = spawnSync("git", ["-C", path, "symbolic-ref", "--short", "HEAD"], {
    encoding: "utf8",
  })
  if (result.status !== 0) return Option.none()
  const branch = result.stdout.trim()
  return branch === "" ? Option.none() : Option.some(branch)
}

/**
 * The guard's three answers, kept apart so no caller reads absence as a branch.
 *
 * `Ungoverned` is not a refusal (the factory governs workstreams, not the machine),
 * `OnBranch` carries the branch it confirmed, and `Mismatch` is the only one with a price.
 */
export type BranchVerdict = Data.TaggedEnum<{
  readonly Ungoverned: {}
  readonly OnBranch: { readonly record: Workstream; readonly branch: string }
  readonly Mismatch: { readonly record: Workstream; readonly reason: string }
}>

const BranchVerdict = Data.taggedEnum<BranchVerdict>()

/** The record that owns a worktree path, through the lookup adoption refuses a second owner with. */
const ownerOf = async (input: {
  readonly path: string
  readonly home?: string | undefined
}): Promise<Option.Option<Workstream>> => {
  const found = ownerOfPath({
    records: await listWorkstreams({ home: input.home }),
    path: input.path,
  })
  return found._tag === "Owned" ? Option.some(found.workstream) : Option.none()
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
 * @returns the owning record and its branch, the refusal naming both branches, or ungoverned.
 */
export const branchGuard = async (input: {
  readonly path: string
  readonly record?: Workstream | undefined
  readonly home?: string | undefined
}): Promise<BranchVerdict> => {
  const owner =
    input.record === undefined
      ? await ownerOf({ path: input.path, home: input.home })
      : Option.some(input.record)
  if (Option.isNone(owner)) return BranchVerdict.Ungoverned()
  const branch = branchOf(input.path)
  if (Option.isSome(branch) && branch.value === owner.value.branch)
    return BranchVerdict.OnBranch({ record: owner.value, branch: branch.value })
  return BranchVerdict.Mismatch({
    record: owner.value,
    reason:
      "BranchMismatch: expected " +
      owner.value.branch +
      ", found " +
      Option.getOrElse(branch, () => NO_BRANCH),
  })
}
