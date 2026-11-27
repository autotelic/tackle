import { AgentOs, hostDirMount, type ExecutionOutcome } from "@rivet-dev/agentos-core"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { permissionsReport, roomVmPermissions, type VmPermissionsReport } from "./VmPermissions.ts"
import type { VmSnapshotExport } from "./VmSnapshot.ts"
import {
  declaredSoftware,
  softwareInputs,
  softwareReport,
  type RoomSoftware,
  type VmSoftwareReport,
} from "./VmSoftware.ts"

/** An embedded agentOS VM owned by one room. The VM owns its filesystem and processes. */
export interface AgentOsRoom {
  readonly id: string
  readonly vm: AgentOs
  readonly workspace: string
  /**
   * What the VM's own software registry reported at boot: the declaration, the installed
   * packages, and the declared names the VM does not list.
   */
  readonly software: VmSoftwareReport
  /**
   * What this guest may reach: the policy the VM was created with, and the sidecar that runs it.
   *
   * The policy half is the room's declaration (`roomVmPermissions`); the sidecar half is the
   * runtime's own `describe()`, recorded so the record never claims a policy the runtime did not
   * run on. `AgentOsSidecarDescription` carries no permission member at 0.4.9 — ADR 0007.
   */
  readonly permissions: VmPermissionsReport
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
  /**
   * A root filesystem captured by an earlier `filesystem.export`, as a lower of this VM's root.
   *
   * The restored VM is a *new* machine built on those bytes: it never adopts the process that
   * wrote them, which is what makes a resume a restore rather than a thawed freeze.
   */
  readonly snapshot?: VmSnapshotExport | undefined
  /**
   * The software this room declares its guest needs. Absent is the default declaration, never
   * a bare VM: a room that names nothing still gets the tools its work depends on.
   */
  readonly software?: RoomSoftware | undefined
  /**
   * Whether Core's vendored default bundle is installed beside the declaration.
   *
   * False is a bare VM — only the declared packages are there — and the declared commands still
   * run, which is what makes the declaration the room's rather than the bundle's.
   */
  readonly defaultSoftware?: boolean | undefined
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
      // The declaration is the room's, always: a VM created without one would boot on
      // whatever bundle Core vendors today, which is the inheritance this seam removes.
      const software = declaredSoftware(input.software)
      const options: Parameters<typeof AgentOs.create>[0] = {
        user: { uid, gid, euid: uid, egid: gid },
        software: [...softwareInputs(software)],
        // Explicit on purpose: the VM is created with a policy the room declares, so what the
        // guest may reach is a fact of this file rather than whatever Core's default is today.
        permissions: roomVmPermissions,
      }
      if (input.defaultSoftware !== undefined) options.defaultSoftware = input.defaultSoftware
      if (input.stateDir !== undefined)
        options.database = {
          type: "sqlite_file",
          path: agentOsDatabaseFile(input.stateDir),
        }
      // Read-write on purpose: a write in the guest is the room's edit, and a read-only
      // mount would make the VM a viewer rather than the place the work happens.
      if (worktree !== undefined)
        options.mounts = [hostDirMount(WORKSPACE, worktree, { readOnly: false })]
      // The snapshot is a lower of the overlay, not its upper: the VM writes its own layer on
      // top, so what it does after a resume never edits the file it was restored from.
      if (input.snapshot !== undefined) options.rootFilesystem = { lowers: [input.snapshot] }
      const vm = await AgentOs.create(options)
      // A mounted /workspace already exists; only an unmounted VM needs one created.
      if (worktree === undefined) await vm.filesystem.mkdir(WORKSPACE, { recursive: true })
      return {
        id: input.id,
        vm,
        workspace: WORKSPACE,
        // The VM's own answer, read once at boot: installed() is the runtime's registry, so
        // the record says what the guest has instead of what the declaration hoped for.
        software: softwareReport(software, vm.software.installed()),
        permissions: permissionsReport({ permissions: roomVmPermissions, sidecar: vm.sidecar }),
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
  /** The resolved executor lease environment; absent means the VM's own base environment. */
  readonly env?: Record<string, string> | undefined
  /** The software the command's room declares; absent is the default declaration. */
  readonly software?: RoomSoftware | undefined
  /** Whether Core's default bundle is installed beside the declaration. */
  readonly defaultSoftware?: boolean | undefined
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
          const options: NonNullable<Parameters<typeof room.vm.process.execFile>[2]> = {
            cwd: room.workspace,
            output: { capture: "all" },
          }
          if (input.env !== undefined) options.env = input.env
          const result = await room.vm.process.execFile(input.command, [...args], options)
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
