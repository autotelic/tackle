import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createRoom, roomDir, setRoomRuntime } from "@autotelic/room/store"
import { startVmSupervisor } from "@autotelic/room/VmSupervisor"
import { Data } from "effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { factoryHome, readWorkstream } from "./store.ts"

/*
 * A candidate is a second checkout of a workstream, before a pull request exists.
 *
 * The factory already has a record called `candidate` (./candidate.ts): one sighting of
 * evidence waiting to become work. That record never touches a worktree. This one is the other
 * half of the same word — the place the answer would be built — so the module and the directory
 * it owns carry `environment` to keep the two apart on disk and on the floor.
 *
 * The store is one JSON file per candidate under FACTORY_HOME, never inside the governed
 * worktree: a candidate that recorded itself in the tree it points at would be committed by the
 * very pass it was created for.
 *
 * Creating one goes through the room store rather than a second copy of it. `board` already
 * depends on `@autotelic/room` for the port lease, the service probe and the VM supervisor, so
 * the direction of that dependency is the one the seam allows: a candidate is a room the factory
 * asked for, and `room vm start` can take it from there.
 */

/** The three states a candidate can be in. A dropped candidate is folded, never deleted. */
export const CandidateEnvironmentState = Schema.Literals(["open", "promoted", "dropped"])
export type CandidateEnvironmentState = typeof CandidateEnvironmentState.Type

/**
 * One candidate checkout, as the store writes it.
 *
 * `room` names the room the candidate owns rather than repeating its path: the room file already
 * holds the worktree symlink, the port lease and the service declaration, and copying those into
 * the candidate would make two records that can disagree.
 *
 * `head` is the workstream head the candidate started from, kept as a fact rather than a pointer:
 * the workstream moves on, and a candidate that forgot where it branched could not be compared.
 */
export const CandidateEnvironment = Schema.Struct({
  version: Schema.Literal(1),
  workstream: Schema.String,
  id: Schema.String,
  room: Schema.String,
  path: Schema.String,
  branch: Schema.String,
  head: Schema.String,
  label: Schema.String,
  state: CandidateEnvironmentState,
  createdAt: Schema.String,
  at: Schema.String,
})
export type CandidateEnvironment = typeof CandidateEnvironment.Type

/** A write or a create the store refuses, naming the record it would have made. */
export class CandidateEnvironmentRefused extends Data.TaggedError("CandidateEnvironmentRefused")<{
  readonly id: string
  readonly detail: string
}> {}

/** The directory holding candidate records, outside every governed repo. */
export const candidateEnvironmentDir = (home: string = factoryHome()): string =>
  join(home, "candidate-environments")

/** The file for one candidate, addressed by its own id. */
export const candidateEnvironmentFile = (input: {
  readonly id: string
  readonly home?: string | undefined
}): string => join(candidateEnvironmentDir(input.home), input.id + ".json")

const slugOf = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "") || "candidate"

/**
 * A candidate's id, from the workstream it isolates and the label a human gave it.
 *
 * The two open candidates of one workstream are the case this exists for, so the label is part of
 * the id: deriving it from the workstream alone would make the second `new` overwrite the first.
 *
 * @param input - the workstream id and the label.
 * @returns a filesystem-safe id.
 */
export const candidateEnvironmentIdOf = (input: {
  readonly workstream: string
  readonly label: string
}): string => slugOf(input.workstream) + "-" + slugOf(input.label)

/**
 * The branch a candidate builds on.
 *
 * It sits under `candidate/` rather than the workstream's own branch because a candidate starts at
 * the head the workstream already pushed: sharing the name would put two checkouts on one branch,
 * which git refuses and a human would misread.
 *
 * @param input - the workstream id and the label.
 * @returns the branch name.
 */
export const candidateBranchOf = (input: {
  readonly workstream: string
  readonly label: string
}): string => "candidate/" + slugOf(input.workstream) + "/" + slugOf(input.label)

/**
 * Read one candidate; malformed is a miss.
 *
 * A stale artifact must degrade to silence rather than to a wrong path: the caller then reports
 * "no such candidate" instead of acting on half a record.
 */
export const readCandidateEnvironment = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<CandidateEnvironment | undefined> => {
  const text = await readFile(candidateEnvironmentFile(input), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const decoded = Schema.decodeResult(Schema.fromJsonString(CandidateEnvironment))(text)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

/**
 * Every decodable candidate, in id order; one malformed file does not hide the rest.
 *
 * @param input - the optional home and workstream filter.
 * @returns the candidates.
 */
export const listCandidateEnvironments = async (input?: {
  readonly home?: string | undefined
  readonly workstream?: string | undefined
}): Promise<ReadonlyArray<CandidateEnvironment>> => {
  const dir = candidateEnvironmentDir(input?.home)
  const names = (await readdir(dir).catch(() => [])).sort((left, right) =>
    left.localeCompare(right),
  )
  const records: Array<CandidateEnvironment> = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    const text = await readFile(join(dir, name), "utf8").catch(() => undefined)
    if (text === undefined) continue
    const decoded = Schema.decodeResult(Schema.fromJsonString(CandidateEnvironment))(text)
    if (!Result.isSuccess(decoded)) continue
    if (input?.workstream !== undefined && decoded.success.workstream !== input.workstream) continue
    records.push(decoded.success)
  }
  return records
}

/**
 * Write one candidate atomically, refusing a record that would not decode.
 *
 * The record is decoded before the write, not after: a caller that passed a state the schema does
 * not name learns here, rather than at the next read of a file nothing can decode.
 */
export const writeCandidateEnvironment = async (input: {
  readonly record: CandidateEnvironment
  readonly home?: string | undefined
}): Promise<CandidateEnvironment> => {
  const decoded = Schema.decodeResult(CandidateEnvironment)(input.record)
  if (Result.isFailure(decoded))
    throw new CandidateEnvironmentRefused({
      id: input.record.id,
      detail: String(decoded.failure),
    })
  const file = candidateEnvironmentFile({ id: decoded.success.id, home: input.home })
  await mkdir(candidateEnvironmentDir(input.home), { recursive: true })
  const temporary = file + ".tmp"
  await writeFile(temporary, JSON.stringify(decoded.success, null, 2) + "\n")
  await rename(temporary, file)
  return decoded.success
}

/**
 * Move an open candidate to a new state.
 *
 * Only an open candidate moves: promoting a dropped one would resurrect a lane a human folded,
 * and re-promoting is not a state change at all.
 */
export const setCandidateEnvironmentState = async (input: {
  readonly id: string
  readonly state: "promoted" | "dropped"
  readonly home?: string | undefined
  readonly at?: string | undefined
}): Promise<CandidateEnvironment> => {
  const current = await readCandidateEnvironment({ id: input.id, home: input.home })
  if (current === undefined)
    throw new CandidateEnvironmentRefused({ id: input.id, detail: "CandidateNotFound" })
  if (current.state === "dropped" && input.state === "promoted")
    throw new CandidateEnvironmentRefused({ id: input.id, detail: "CandidateDropped" })
  return writeCandidateEnvironment({
    record: {
      ...current,
      state: input.state,
      at: input.at ?? new Date().toISOString(),
    },
    home: input.home,
  })
}

/**
 * Add a candidate checkout at the workstream's current head.
 *
 * A worktree is created with git, because the branch must be the candidate's own and start where
 * the workstream is now; the room's own `ensure` names its branches `room/…`, which would put the
 * candidate commits where no pull request looks. The room file is then written through the room
 * store, so the board's existing room scan finds the lease, the service and the preview without a
 * second reader.
 *
 * Existing paths are reused rather than refused: git will not add one directory twice, and a
 * second `new` for a candidate that already exists is the human re-entering a command.
 *
 * @param input - the workstream id, the label, the room root and the home.
 * @returns the record as written.
 */
export const createCandidateEnvironment = async (input: {
  readonly workstream: string
  readonly label: string
  readonly roomRoot: string
  readonly home?: string | undefined
  readonly at?: string | undefined
  /** Start the candidate room's agentOS supervisor. The CLI defaults this on. */
  readonly vm?: boolean | undefined
}): Promise<CandidateEnvironment> => {
  const workstream = await readWorkstream({ id: input.workstream, home: input.home })
  if (workstream === undefined)
    throw new CandidateEnvironmentRefused({
      id: input.workstream,
      detail: "WorkstreamNotFound",
    })
  const id = candidateEnvironmentIdOf({ workstream: workstream.id, label: input.label })
  const branch = candidateBranchOf({ workstream: workstream.id, label: input.label })
  const root = resolve(input.roomRoot)
  const path = join(root, id, "worktree")
  // The record can lag the checkout after a manual fix or a merge. A candidate branches from
  // what the workstream actually has now, not from the last pass receipt.
  const actual = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: workstream.path,
    encoding: "utf8",
  })
  const head =
    actual.status === 0 && actual.stdout.trim() !== "" ? actual.stdout.trim() : workstream.head
  if (!existsSync(join(path, ".git"))) {
    // The workstream's own checkout is the repository git resolves the new worktree against;
    // `record.repo` is the GitHub slug, which is not a directory. A directory removed outside
    // git leaves a registration behind; prune it before the branch check so a re-created
    // candidate takes its own path back.
    spawnSync("git", ["worktree", "prune"], { cwd: workstream.path, encoding: "utf8" })
    const exists = spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/" + branch], {
      cwd: workstream.path,
      encoding: "utf8",
    })
    // A branch can outlive its worktree (a previous candidate was removed). Reattach it
    // rather than resetting it: the branch may hold the only copy of that candidate's work.
    const added =
      exists.status === 0
        ? spawnSync("git", ["worktree", "add", path, branch], {
            cwd: workstream.path,
            encoding: "utf8",
          })
        : spawnSync("git", ["worktree", "add", "-b", branch, path, head], {
            cwd: workstream.path,
            encoding: "utf8",
          })
    if (added.status !== 0)
      throw new CandidateEnvironmentRefused({
        id,
        detail: "WorktreeFailed: " + (added.stderr.trim() || String(added.status)),
      })
  }
  const room = await createRoom({
    root,
    id,
    repo: workstream.path,
    scope: input.label,
    base: branch,
    at: Date.now(),
  })
  // A room already at this id is the second `new` for one candidate, not a collision: the
  // worktree above was reused for the same reason.
  if (!room.ok && room.error !== "RoomAlreadyExists")
    throw new CandidateEnvironmentRefused({ id, detail: "RoomRefused: " + room.error })
  if (input.vm === true) {
    const started = await startVmSupervisor({
      root,
      id,
      worktree: path,
      stateDir: roomDir({ root, id }),
    })
    if (!started.ok)
      throw new CandidateEnvironmentRefused({ id, detail: "VmFailed: " + started.reason })
    const runtime = await setRoomRuntime({ root, id, runtime: { kind: "agentos" } })
    if (!runtime.ok)
      throw new CandidateEnvironmentRefused({ id, detail: "RuntimeRefused: " + runtime.error })
  }
  const at = input.at ?? new Date().toISOString()
  return writeCandidateEnvironment({
    record: {
      version: 1,
      workstream: workstream.id,
      id,
      room: id,
      path,
      branch,
      head,
      label: input.label,
      state: "open",
      createdAt: at,
      at,
    },
    home: input.home,
  })
}

/**
 * Record a candidate that already exists, without creating anything.
 *
 * A human who made the checkout by hand still needs the lane to be visible, and inventing a
 * worktree would be worse than recording the one they have.
 */
export const registerCandidateEnvironment = async (input: {
  readonly workstream: string
  readonly label: string
  readonly path: string
  readonly branch: string
  readonly head: string
  readonly room?: string | undefined
  readonly home?: string | undefined
  readonly at?: string | undefined
}): Promise<CandidateEnvironment> => {
  const id = candidateEnvironmentIdOf({ workstream: input.workstream, label: input.label })
  const at = input.at ?? new Date().toISOString()
  return writeCandidateEnvironment({
    record: {
      version: 1,
      workstream: input.workstream,
      id,
      room: input.room ?? id,
      path: resolve(input.path),
      branch: input.branch,
      head: input.head,
      label: input.label,
      state: "open",
      createdAt: at,
      at,
    },
    home: input.home,
  })
}
