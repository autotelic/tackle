import { AgentOs, hostDirMount, type ExecutionOutcome } from "@rivet-dev/agentos-core"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"

/** An embedded agentOS VM owned by one room. The VM owns its filesystem and processes. */
export interface AgentOsRoom {
  readonly id: string
  readonly vm: AgentOs
  readonly workspace: string
  readonly dispose: () => Promise<void>
}

export class AgentOsRoomError extends Error {
  readonly _tag = "AgentOsRoomError"
}

const WORKSPACE = "/workspace"

/** The one file a room's VM keeps its durable state in, inside the room's state directory. */
export const agentOsDatabaseFile = (stateDir: string): string => join(stateDir, "agentos.sqlite")

export interface AgentOsRoomOptions {
  readonly id: string
  /**
   * Host directory projected into the VM at `/workspace`, read-write. Omitted, the VM gets a
   * filesystem of its own and nothing on the host can be reached.
   */
  readonly worktree?: string
  /** Host directory holding the VM's sqlite database, so its state outlives this process. */
  readonly stateDir?: string
}

/**
 * Create one embedded agentOS VM. No hosted endpoint or Rivet credential is involved: the
 * native sidecar runs in this process, and the VM's filesystem is its own unless a worktree
 * is mounted.
 */
export const createAgentOsRoom = (
  input: AgentOsRoomOptions,
): Effect.Effect<AgentOsRoom, AgentOsRoomError> =>
  Effect.tryPromise({
    try: async () => {
      const worktree = input.worktree === undefined ? undefined : resolve(input.worktree)
      // Both paths must exist before the VM boots: a host_dir projection has nothing to
      // project onto, and sqlite will not create the room's state directory itself.
      if (input.stateDir !== undefined) await mkdir(input.stateDir, { recursive: true })
      if (worktree !== undefined) await mkdir(worktree, { recursive: true })
      // The guest must run as the host user that owns the mounted worktree. A default VM
      // user (1000) is not the host uid, so a host mount of a 0700 temp dir or a 0600 checkout
      // answers EACCES even though the mount itself is read-write. The mount is the room, and
      // the room belongs to this user; matching the ids is what makes the projection usable.
      const uid = process.getuid?.() ?? 1000
      const gid = process.getgid?.() ?? 1000
      const vm = await AgentOs.create({
        user: { uid, gid, euid: uid, egid: gid },
        ...(input.stateDir === undefined
          ? {}
          : {
              database: { type: "sqlite_file" as const, path: agentOsDatabaseFile(input.stateDir) },
            }),
        // Read-write on purpose: a write in the guest is the room's edit, and a read-only
        // mount would make the VM a viewer rather than the place the work happens.
        ...(worktree === undefined
          ? {}
          : { mounts: [hostDirMount(WORKSPACE, worktree, { readOnly: false })] }),
      })
      // A mounted /workspace already exists; only an unmounted VM needs one created.
      if (worktree === undefined) await vm.filesystem.mkdir(WORKSPACE, { recursive: true })
      return {
        id: input.id,
        vm,
        workspace: WORKSPACE,
        dispose: async () => {
          await vm.dispose()
        },
      }
    },
    catch: (cause) => new AgentOsRoomError(String(cause)),
  })

export interface AgentOsCommand {
  readonly id: string
  readonly worktree?: string
  readonly stateDir?: string
  readonly command: string
  readonly args?: ReadonlyArray<string>
}

/** What one command in a room's VM did, in the shape a caller can print and exit on. */
export interface AgentOsCommandResult {
  readonly id: string
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly outcome: ExecutionOutcome
  /** The runtime's own account of a command that never produced an exit code. */
  readonly error: string | null
}

/**
 * Run one command with `/workspace` as its working directory, in a VM this call owns. The VM
 * is created for the command and disposed in every case, so a one-shot command cannot leak a
 * sidecar.
 */
export const runAgentOsCommand = (
  input: AgentOsCommand,
): Effect.Effect<AgentOsCommandResult, AgentOsRoomError> => {
  const args = input.args ?? []
  return Effect.acquireUseRelease(
    createAgentOsRoom(input),
    (room) =>
      Effect.tryPromise({
        try: async () => {
          const result = await room.vm.process.execFile(input.command, [...args], {
            cwd: room.workspace,
            output: { capture: "all" },
          })
          return {
            id: input.id,
            command: input.command,
            args,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
            // A command that timed out or was cancelled has no exit code; reporting 1 keeps
            // the CLI's exit honest instead of claiming the success a `0` would mean.
            exitCode: result.exitCode ?? (result.outcome === "succeeded" ? 0 : 1),
            outcome: result.outcome,
            error: result.error?.message ?? null,
          }
        },
        catch: (cause) => new AgentOsRoomError(String(cause)),
      }),
    (room) =>
      Effect.tryPromise({
        try: () => room.dispose(),
        catch: (cause) => new AgentOsRoomError(String(cause)),
      }).pipe(Effect.orDie),
  )
}
