import { Result } from "effect"
import { run } from "./shell.ts"

/*
 * Git, as much of it as the room needs.
 *
 * A review never touches the main checkout. It gets a detached worktree at the PR's head
 * SHA, so the person's index, branch, and stash are not part of the review's blast radius.
 * The worktree is removed on success and quarantined on failure — a crashed job is
 * reported, never silently reused.
 */

/** The origin remote, split. */
export interface RepoRef {
  readonly owner: string
  readonly name: string
}

/**
 * Parse the origin remote into owner/name, tolerating both SSH and HTTPS forms.
 *
 * @param root - The repository root.
 * @returns The owner and name, or why the remote could not be read.
 */
export const repoOf = (root: string): Result.Result<RepoRef, string> => {
  const remote = run({ command: "git", args: ["remote", "get-url", "origin"], cwd: root })
  if (remote.code !== 0) return Result.fail("no origin remote")
  const match =
    /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/.exec(remote.stdout.trim()) ??
    /[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote.stdout.trim())
  const owner = match?.[1]
  const name = match?.[2]
  return owner === undefined || name === undefined
    ? Result.fail("origin is not a GitHub repository")
    : Result.succeed({ owner, name })
}

/**
 * The repository root git reports.
 *
 * @param root - A directory inside the repository.
 * @returns The top level, or why git could not name it.
 */
export const topLevel = (root: string): Result.Result<string, string> => {
  const result = run({ command: "git", args: ["rev-parse", "--show-toplevel"], cwd: root })
  return result.code === 0
    ? Result.succeed(result.stdout.trim())
    : Result.fail("not a git work tree")
}

/**
 * Fetch one commit from origin.
 *
 * @param input - The repository root and the commit.
 * @returns Success, or git's message.
 */
export const fetchCommit = (input: {
  readonly root: string
  readonly sha: string
}): Result.Result<true, string> => {
  const result = run({
    command: "git",
    args: ["fetch", "origin", input.sha, "--depth=1"],
    cwd: input.root,
  })
  return result.code === 0 ? Result.succeed(true) : Result.fail(result.stderr.trim())
}

/**
 * Create a detached worktree at a commit.
 *
 * @param input - The repository root, the commit, and the destination.
 * @returns Success, or git's message.
 */
export const addWorktree = (input: {
  readonly root: string
  readonly sha: string
  readonly dir: string
}): Result.Result<true, string> => {
  const result = run({
    command: "git",
    args: ["worktree", "add", "--detach", input.dir, input.sha],
    cwd: input.root,
  })
  return result.code === 0 ? Result.succeed(true) : Result.fail(result.stderr.trim())
}

/**
 * Remove a worktree, discarding its changes.
 *
 * @param input - The repository root and the worktree.
 * @returns Success, or git's message.
 */
export const removeWorktree = (input: {
  readonly root: string
  readonly dir: string
}): Result.Result<true, string> => {
  const result = run({
    command: "git",
    args: ["worktree", "remove", "--force", input.dir],
    cwd: input.root,
  })
  return result.code === 0 ? Result.succeed(true) : Result.fail(result.stderr.trim())
}
