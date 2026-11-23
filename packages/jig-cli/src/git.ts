import { Effect } from "effect"
import { exec, type Spawner } from "./exec.ts"

/*
 * The one thing `jig` asks git, for `gate.mode: "touched-files"`.
 *
 * "Touched" is the change in front of you, measured against `HEAD`: modified tracked
 * files, staged edits, and untracked files. A repo with no commit yet has no `HEAD` to
 * diff against, so every tracked file counts as touched — the honest answer when there
 * is no baseline commit to have touched anything since.
 *
 * A repo git cannot read (not a repository, git absent) returns `undefined`, and the
 * caller degrades the scope to `all`, never to the empty set: an empty set would pass
 * every finding, which is the false-clean failure this workspace is built to prevent.
 */

const lines = (text: string): ReadonlyArray<string> =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

/** One invocation of a program, or `undefined` when it fails or is missing. */
const command = (input: {
  readonly binary: string
  readonly root: string
  readonly args: ReadonlyArray<string>
}): Effect.Effect<string | undefined, never, Spawner> =>
  Effect.match(exec({ binary: input.binary, args: input.args, cwd: input.root }), {
    onFailure: () => undefined,
    onSuccess: (outcome) => (outcome.code === 0 ? outcome.stdout : undefined),
  })

/** One git invocation, or `undefined` when git fails or is missing. */
const git = (root: string, args: ReadonlyArray<string>) => command({ binary: "git", root, args })

/** The repo-relative paths a working-tree change touches, or `undefined` when git cannot say. */
export const touchedFiles = (
  root: string,
): Effect.Effect<ReadonlySet<string> | undefined, never, Spawner> =>
  Effect.gen(function* () {
    const inside = yield* git(root, ["rev-parse", "--is-inside-work-tree"])
    if (inside === undefined || inside.trim() !== "true") return undefined
    const head = yield* git(root, ["rev-parse", "--verify", "HEAD"])
    // No HEAD means no commit to diff against; everything tracked is "new since then".
    const changed =
      head === undefined
        ? yield* git(root, ["ls-files"])
        : yield* git(root, ["diff", "--name-only", "--relative", "HEAD"])
    if (changed === undefined) return undefined
    const untracked = yield* git(root, ["ls-files", "--others", "--exclude-standard"])
    return new Set([...lines(changed), ...lines(untracked ?? "")])
  })

/**
 * The repo-relative paths a branch changes against `revision`, or `undefined` when git cannot
 * resolve it.
 *
 * Two dots, not three: `git diff <rev>` compares the revision to the WORKING TREE, so commits
 * already on the branch and uncommitted edits answer the same question -- "what does this
 * change introduce" -- which is the one a review gate asks. A three-dot diff would compare
 * two commits and quietly ignore the edit someone is still making.
 *
 * Untracked files are included for the same reason `touchedFiles` includes them: a new file
 * that no engine has seen is exactly the surface a gate must not skip.
 */
export const changedSince = (input: {
  readonly root: string
  readonly revision: string
}): Effect.Effect<ReadonlySet<string> | undefined, never, Spawner> =>
  Effect.gen(function* () {
    // A revision that does not resolve is a typo or an uncompleted clone; degrading to the
    // whole tree would answer a different question, so the answer is undefined and the caller
    // says why.
    const resolved = yield* git(input.root, ["rev-parse", "--verify", `${input.revision}^{commit}`])
    if (resolved === undefined) return undefined
    const changed = yield* git(input.root, ["diff", "--name-only", "--relative", input.revision])
    if (changed === undefined) return undefined
    const untracked = yield* git(input.root, ["ls-files", "--others", "--exclude-standard"])
    return new Set([...lines(changed), ...lines(untracked ?? "")])
  })

/**
 * The repo-relative paths a pull request changes, asked of `gh`.
 *
 * `gh` rather than a local diff because the PR's base may not be a ref this checkout has,
 * and the merge base GitHub computed is the one the reviewer is looking at. The number is
 * optional: `gh` resolves the pull request for the current branch, which is what a person
 * means by "--pr" on the branch they are on.
 *
 * `undefined` means `gh` could not answer -- absent, unauthenticated, or no PR for the
 * branch -- and the caller reports that instead of running the gate over everything or
 * nothing.
 */
export const changedInPullRequest = (input: {
  readonly root: string
  /** The pull request number or URL. Absent asks `gh` for the current branch's PR. */
  readonly number?: string | undefined
}): Effect.Effect<ReadonlySet<string> | undefined, never, Spawner> =>
  Effect.gen(function* () {
    const args =
      input.number === undefined
        ? ["pr", "view", "--json", "files", "--jq", ".files[].path"]
        : ["pr", "view", input.number, "--json", "files", "--jq", ".files[].path"]
    const listed = yield* command({ binary: "gh", root: input.root, args })
    if (listed === undefined) return undefined
    return new Set(lines(listed))
  })
