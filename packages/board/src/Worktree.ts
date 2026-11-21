import { Context, Effect, Layer } from "effect"
import { execFile } from "node:child_process"
import { mkdir, rename } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

/** Where a room's data lives. The provider owns the worktree, never the process. */
export interface WorktreeService {
  readonly ensure: (input: {
    readonly root: string
    readonly repo: string
    readonly base: string
  }) => Effect.Effect<string, WorktreeError>
  readonly archive: (input: { readonly root: string }) => Effect.Effect<void, WorktreeError>
}

export class WorktreeError extends Error {
  readonly _tag = "WorktreeError"
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.detail = detail
  }
}

export class Worktree extends Context.Service<Worktree, WorktreeService>()("Worktree") {}

/**
 * A git worktree per room, so two roomes never edit one checkout. The
 * directory is the unit; the supervisor owns the processes inside it.
 */
export const WorktreeLive = Layer.effect(
  Worktree,
  Effect.succeed({
    ensure: ({ root, repo, base }) =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(join(root, ".."), { recursive: true })
          await run("git", ["worktree", "add", "-B", `room/${base}`, root, base], { cwd: repo })
          return root
        },
        catch: (cause) => new WorktreeError(String(cause)),
      }),
    archive: ({ root }) =>
      Effect.tryPromise({
        try: async () => {
          const cold = join(root, "..", "cold", `${root.split("/").at(-1)}-${Date.now()}`)
          await mkdir(join(root, "..", "cold"), { recursive: true })
          await rename(root, cold)
        },
        catch: (cause) => new WorktreeError(String(cause)),
      }),
  }),
)
