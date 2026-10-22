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

/** One git invocation, or `undefined` when git fails or is missing. */
const git = (
  root: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string | undefined, never, Spawner> =>
  Effect.match(exec({ binary: "git", args, cwd: root }), {
    onFailure: () => undefined,
    onSuccess: (outcome) => (outcome.code === 0 ? outcome.stdout : undefined),
  })

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
