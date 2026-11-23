import { Effect } from "effect"
import { join } from "node:path"
import { WorktreeError, type WorktreeService } from "./Worktree.ts"

export { WorktreeError as ProviderError } from "./Worktree.ts"

/**
 * Where a room's controlled filesystem lives.
 *
 * The provider owns placement, never the room's state. The local provider is the existing
 * git worktree; the agentOS provider is the same contract over a VM handle, so a room can
 * be backed by either without teaching the store about Rivet.
 */
export type ProviderPlacement = {
  readonly id: string
  readonly root: string
  readonly repo: string
  readonly base: string
}

export type ProviderAttachment = {
  readonly id: string
  readonly root: string
  readonly repo: string
  readonly branch: string
}

export interface RoomProvider {
  readonly kind: "local" | "agentos"
  readonly ensure: (input: ProviderPlacement) => Effect.Effect<string, WorktreeError>
  readonly attach: (input: ProviderAttachment) => Effect.Effect<string, WorktreeError>
}

const placementRoot = (input: { readonly root: string; readonly id: string }): string =>
  join(input.root, input.id, "worktree")

/** The existing worktree provider, adapted to the room-provider contract. */
export const localRoomProvider = (trees: WorktreeService): RoomProvider => ({
  kind: "local",
  ensure: (input) =>
    trees
      .ensure({
        root: placementRoot(input),
        repo: input.repo,
        base: input.base,
      })
      .pipe(Effect.mapError((cause) => new WorktreeError(cause.detail))),
  attach: (input) =>
    trees
      .attach({
        root: placementRoot(input),
        repo: input.repo,
        branch: input.branch,
      })
      .pipe(Effect.mapError((cause) => new WorktreeError(cause.detail))),
})

/**
 * The small part of an agentOS VM this adapter needs. Keeping it structural means the room
 * package does not take a React/Rivet dependency just to name the contract; the caller
 * injects a client, and tests can inject the same shape without a running engine.
 */
export interface AgentOsVm {
  readonly process: {
    readonly run: (input: {
      readonly command: string
      readonly args?: ReadonlyArray<string> | undefined
      readonly options?:
        | {
            readonly cwd?: string | undefined
            readonly captureStdio?: boolean | undefined
          }
        | undefined
    }) => Promise<{
      readonly status: { readonly exitCode: number }
      readonly stdout: string
      readonly stderr: string
    }>
  }
}

export interface AgentOsClient {
  readonly agentOS: {
    readonly getOrCreate: (key: ReadonlyArray<string>) => AgentOsVm
  }
}

const AGENTOS_WORKSPACE = "/workspace"

const cloneInto = (input: {
  readonly vm: AgentOsVm
  readonly repo: string
  readonly branch: string
  readonly label: string
}): Effect.Effect<string, WorktreeError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await input.vm.process.run({
        command: "git",
        args: ["clone", "--branch", input.branch, "--single-branch", input.repo, AGENTOS_WORKSPACE],
        options: { cwd: "/", captureStdio: true },
      })
      if (result.status.exitCode !== 0)
        throw new WorktreeError(
          "agentOS " +
            input.label +
            " failed with exit " +
            result.status.exitCode +
            ": " +
            (result.stderr.trim() || result.stdout.trim()),
        )
      return AGENTOS_WORKSPACE
    },
    catch: (cause) => (cause instanceof WorktreeError ? cause : new WorktreeError(String(cause))),
  })

/**
 * Place a room's checkout inside an agentOS VM. Each room gets its own actor key, so two
 * rooms cannot share a filesystem even when they run on the same engine.
 */
export const agentOsRoomProvider = (client: AgentOsClient): RoomProvider => {
  const vmFor = (id: string): AgentOsVm => client.agentOS.getOrCreate(["rooms", id])
  return {
    kind: "agentos",
    ensure: (input) =>
      cloneInto({ vm: vmFor(input.id), repo: input.repo, branch: input.base, label: "clone" }),
    attach: (input) =>
      cloneInto({ vm: vmFor(input.id), repo: input.repo, branch: input.branch, label: "attach" }),
  }
}

/** Pick the provider without making a missing agentOS endpoint a failed room creation. */
export const selectRoomProvider = (input: {
  readonly trees: WorktreeService
  readonly agentOs?: AgentOsClient | undefined
}): RoomProvider =>
  input.agentOs === undefined ? localRoomProvider(input.trees) : agentOsRoomProvider(input.agentOs)
