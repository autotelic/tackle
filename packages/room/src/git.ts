import { run } from "./shell.ts"

/*
 * Git, as much of it as the room needs.
 *
 * A review never touches the main checkout. It gets a detached worktree at the PR's head
 * SHA, so the person's index, branch, and stash are not part of the review's blast radius.
 * The worktree is removed on success and quarantined on failure — a crashed job is
 * reported, never silently reused.
 */

export interface RepoRef {
  readonly owner: string
  readonly name: string
}

/** Parse the origin remote into owner/name, tolerating both SSH and HTTPS forms. */
export const repoOf = (root: string): RepoRef | undefined => {
  const remote = run({ command: "git", args: ["remote", "get-url", "origin"], cwd: root })
  if (remote.code !== 0) return undefined
  const match =
    /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/.exec(remote.stdout.trim()) ??
    /[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote.stdout.trim())
  const owner = match?.[1]
  const name = match?.[2]
  return owner === undefined || name === undefined ? undefined : { owner, name }
}

export const topLevel = (root: string): string | undefined => {
  const result = run({ command: "git", args: ["rev-parse", "--show-toplevel"], cwd: root })
  return result.code === 0 ? result.stdout.trim() : undefined
}

export const fetchCommit = (root: string, sha: string): boolean =>
  run({ command: "git", args: ["fetch", "origin", sha, "--depth=1"], cwd: root }).code === 0

export const addWorktree = (root: string, sha: string, dir: string): boolean =>
  run({ command: "git", args: ["worktree", "add", "--detach", dir, sha], cwd: root }).code === 0

export const removeWorktree = ({
  root,
  dir,
}: {
  readonly root: string
  readonly dir: string
}): boolean =>
  run({ command: "git", args: ["worktree", "remove", "--force", dir], cwd: root }).code === 0
