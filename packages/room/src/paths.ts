import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { isRecord, str } from "@autotelic/board"
import type { RoomConfig } from "./config.ts"

/*
 * Where the room keeps what is not committed.
 *
 * `~/.room/<login>/<projectId>/` is the whole namespace. Two people on one machine cannot
 * collide, two checkouts of one repo cannot collide, and a second room for the same project
 * at another stage is a sibling directory. The committed half is `.room/config.json`; the
 * rest is local state, worktrees, and job transcripts.
 */

export const roomHome = (): string => process.env.ROOM_HOME ?? join(homedir(), ".room")

export const stateDir = (config: RoomConfig): string =>
  join(roomHome(), config.stage.replace(/^local\//, ""), config.project.id)

export const databasePath = (config: RoomConfig): string => join(stateDir(config), "room.sqlite")
export const worktreeRoot = (config: RoomConfig): string => join(stateDir(config), "wt")
export const jobsRoot = (config: RoomConfig): string => join(stateDir(config), "jobs")

export const indexOfRooms = (): string => join(roomHome(), "index.json")

export interface RoomIndexEntry {
  readonly room: string
  readonly name: string
  readonly projectId: string
  readonly stage: string
  readonly configPath: string
  readonly lastSeen: number
}

interface RoomIndex {
  readonly version: 1
  readonly rooms: ReadonlyArray<RoomIndexEntry>
}

const decodeEntry = (value: unknown): RoomIndexEntry | undefined => {
  if (!isRecord(value)) return undefined
  const room = str(value.room)
  const name = str(value.name)
  const projectId = str(value.projectId)
  const stage = str(value.stage)
  const configPath = str(value.configPath)
  if (
    room === undefined ||
    name === undefined ||
    projectId === undefined ||
    stage === undefined ||
    configPath === undefined
  ) {
    return undefined
  }
  return {
    room,
    name,
    projectId,
    stage,
    configPath,
    lastSeen: typeof value.lastSeen === "number" ? value.lastSeen : 0,
  }
}

/** Read the index; a malformed file is an empty index, never a failed command. */
export const readIndex = (): RoomIndex => {
  try {
    const value: unknown = JSON.parse(readFileSync(indexOfRooms(), "utf8"))
    if (!isRecord(value) || !Array.isArray(value.rooms)) return { version: 1, rooms: [] }
    const rooms = value.rooms.flatMap((entry) => {
      const decoded = decodeEntry(entry)
      return decoded === undefined ? [] : [decoded]
    })
    return { version: 1, rooms }
  } catch {
    return { version: 1, rooms: [] }
  }
}

/** Record or refresh one room. Sorted by activity when read, so the picker is honest. */
export const recordRoom = (entry: RoomIndexEntry): void => {
  mkdirSync(roomHome(), { recursive: true })
  const current = readIndex()
  const rooms = current.rooms.filter((room) => room.room !== entry.room)
  rooms.push(entry)
  const next: RoomIndex = { version: 1, rooms }
  writeFileSync(indexOfRooms(), `${JSON.stringify(next, null, 2)}\n`)
}

/** Active rooms first. A room is "active" when something touched it recently. */
export const roomsByActivity = (now = Date.now()): ReadonlyArray<RoomIndexEntry> =>
  [...readIndex().rooms].sort((left, right) => right.lastSeen - left.lastSeen).map((room) => room)

export const ensureState = (config: RoomConfig): void => {
  mkdirSync(stateDir(config), { recursive: true })
  mkdirSync(worktreeRoot(config), { recursive: true })
  mkdirSync(jobsRoot(config), { recursive: true })
}

export const configPathOf = (root: string): string => join(root, ".room", "config.json")
export const configExists = (root: string): boolean => existsSync(configPathOf(root))
