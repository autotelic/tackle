import { AgentOs } from "@rivet-dev/agentos-core"
import { Effect } from "effect"

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

/**
 * Create one embedded agentOS VM. No hosted endpoint or Rivet credential is involved: the
 * native sidecar runs in this process, and the VM's filesystem is its own.
 */
export const createAgentOsRoom = (input: {
  readonly id: string
}): Effect.Effect<AgentOsRoom, AgentOsRoomError> =>
  Effect.tryPromise({
    try: async () => {
      const vm = await AgentOs.create()
      await vm.filesystem.mkdir(WORKSPACE, { recursive: true })
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
