import { realpath as realpathOf } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"
import type { Session } from "./sessions.ts"

/*
 * A session belongs to a room when its cwd is inside that room's worktree, after resolving
 * both sides. Prefix matching on the raw store paths is wrong here: hc reports /private/var
 * where the room store may say /var, and a symlinked checkout has two names for one tree.
 * The longest matching worktree wins, and the result is a cwd join: provisional by nature.
 */

export interface RoomWorktree {
  readonly id: string
  readonly worktree: string
}

const inside = ({
  child,
  parent,
}: {
  readonly child: string
  readonly parent: string
}): boolean => {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith(".." + sep) && path !== ".." && !path.startsWith(sep))
}

/** Join sessions to rooms by resolved worktree, keeping the match evidence. */
export const joinSessions = async (input: {
  readonly sessions: ReadonlyArray<Session>
  readonly rooms: ReadonlyArray<RoomWorktree>
  readonly realpath?: (path: string) => Promise<string>
}): Promise<ReadonlyArray<Session>> => {
  const realpath = input.realpath ?? realpathOf
  const rooms = (
    await Promise.all(
      input.rooms.map(async (room) => ({
        id: room.id,
        path: await realpath(room.worktree).catch(() => undefined),
      })),
    )
  ).filter((room): room is { id: string; path: string } => room.path !== undefined)

  return Promise.all(
    input.sessions.map(async (session) => {
      const cwd = await realpath(resolve(session.cwd)).catch(() => undefined)
      if (cwd === undefined) return session
      const match = rooms
        .filter((room) => inside({ child: cwd, parent: room.path }))
        .sort((left, right) => right.path.length - left.path.length)[0]
      return match === undefined
        ? session
        : { ...session, roomId: match.id, joinedBy: "cwd" as const }
    }),
  )
}
