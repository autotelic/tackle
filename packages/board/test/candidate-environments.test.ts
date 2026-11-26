/* oxlint-disable plumb/prefer-property-tests -- the store's shapes are fixed fixtures, and a
   generated claim would not exercise the malformed file this suite exists for. */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import {
  CandidateEnvironmentRefused,
  candidateBranchOf,
  candidateEnvironmentDir,
  candidateEnvironmentFile,
  candidateEnvironmentIdOf,
  createCandidateEnvironment,
  listCandidateEnvironments,
  readCandidateEnvironment,
  registerCandidateEnvironment,
  setCandidateEnvironmentState,
  writeCandidateEnvironment,
} from "../src/factory/candidate-environments.ts"

const SHA = "1".repeat(40)

/** A workstream record with every field the store requires, so the fixture cannot rot silently. */
const workstreamRecord = (input: { id: string; path: string; head?: string }) => ({
  version: 1,
  id: input.id,
  project: "P-AUT-128",
  label: input.id,
  repo: "autotelic/tackle",
  path: input.path,
  branch: "factory/" + input.id,
  head: input.head ?? SHA,
  delivery: "trunk",
  base: "main",
  baseSha: SHA,
  prHead: SHA,
  diverged: false,
  phase: "build",
  deps: [],
  lease: { holder: "test", generation: 1 },
  cursors: { github: "2026-11-23T00:00:00.000Z", linear: "" },
  budgets: { passesPerPhase: 5, wallMinutesPerPass: 30, tokensPerDay: 0, roundsOfChanges: 2 },
  autonomy: [],
  desk: [],
  checkpoint: { sha: SHA, ref: "refs/bench/x", at: "2026-11-23T00:00:00.000Z", pushed: true },
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
})

const withHome = async (run: (home: string) => Promise<void>): Promise<void> => {
  const home = mkdtempSync(join(tmpdir(), "factory-candidate-"))
  try {
    await run(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

/** A repository with one commit, so a candidate worktree has a head to start from. */
const repository = (): { readonly path: string; readonly head: string } => {
  const path = mkdtempSync(join(tmpdir(), "factory-candidate-repo-"))
  const git = (...args: ReadonlyArray<string>) =>
    execFileSync("git", ["-C", path, ...args], { encoding: "utf8" })
  execFileSync("git", ["init", "--initial-branch=main", path])
  execFileSync("git", [
    "-C",
    path,
    "-c",
    "user.email=t@example.com",
    "-c",
    "user.name=t",
    "commit",
    "--allow-empty",
    "-m",
    "root",
  ])
  return { path, head: git("rev-parse", "HEAD").trim() }
}

test("a candidate round-trips through the store", () =>
  withHome(async (home) => {
    const written = await registerCandidateEnvironment({
      workstream: "tackle-factory",
      label: "spike",
      path: "/tmp/lanes/spike",
      branch: "candidate/tackle-factory/spike",
      head: SHA,
      home,
      at: "2026-11-23T10:00:00.000Z",
    })
    expect(written.state).toBe("open")
    expect(written.room).toBe(written.id)
    expect(await readCandidateEnvironment({ id: written.id, home })).toEqual(written)
    expect(readFileSync(candidateEnvironmentFile({ id: written.id, home }), "utf8")).toContain(
      '"version": 1',
    )
  }))

test("a malformed candidate file is a miss that hides no other record", () =>
  withHome(async (home) => {
    const good = await registerCandidateEnvironment({
      workstream: "tackle-factory",
      label: "good",
      path: "/tmp/lanes/good",
      branch: "candidate/tackle-factory/good",
      head: SHA,
      home,
    })
    mkdirSync(candidateEnvironmentDir(home), { recursive: true })
    writeFileSync(join(candidateEnvironmentDir(home), "torn.json"), '{"version":1,"workstream":')
    expect(await readCandidateEnvironment({ id: "torn", home })).toBeUndefined()
    const listed = await listCandidateEnvironments({ home })
    expect(listed.map((record) => record.id)).toEqual([good.id])
  }))

test("one workstream can hold two open candidates", () =>
  withHome(async (home) => {
    for (const label of ["spike", "probe"]) {
      await registerCandidateEnvironment({
        workstream: "tackle-factory",
        label,
        path: "/tmp/lanes/" + label,
        branch: candidateBranchOf({ workstream: "tackle-factory", label }),
        head: SHA,
        home,
      })
    }
    const listed = await listCandidateEnvironments({ home, workstream: "tackle-factory" })
    expect(listed.length).toBe(2)
    expect(new Set(listed.map((record) => record.id)).size).toBe(2)
    expect(listed.every((record) => record.state === "open")).toBe(true)
  }))

test("promote and drop move the state and leave the record addressable", () =>
  withHome(async (home) => {
    const open = await registerCandidateEnvironment({
      workstream: "tackle-factory",
      label: "spike",
      path: "/tmp/lanes/spike",
      branch: "candidate/tackle-factory/spike",
      head: SHA,
      home,
      at: "2026-11-23T10:00:00.000Z",
    })
    const promoted = await setCandidateEnvironmentState({
      id: open.id,
      state: "promoted",
      home,
      at: "2026-11-23T11:00:00.000Z",
    })
    expect(promoted.state).toBe("promoted")
    expect(promoted.at).toBe("2026-11-23T11:00:00.000Z")
    expect((await readCandidateEnvironment({ id: open.id, home }))?.state).toBe("promoted")

    const dropped = await setCandidateEnvironmentState({
      id: open.id,
      state: "dropped",
      home,
      at: "2026-11-23T12:00:00.000Z",
    })
    expect(dropped.state).toBe("dropped")
    // A dropped lane keeps its record: the floor folds it rather than losing the fact.
    expect((await listCandidateEnvironments({ home })).length).toBe(1)
    const refused = await setCandidateEnvironmentState({
      id: open.id,
      state: "promoted",
      home,
    }).catch((cause: unknown) => cause)
    expect(refused).toBeInstanceOf(CandidateEnvironmentRefused)
  }))

test("a write of a record the schema does not name is refused before it lands", () =>
  withHome(async (home) => {
    const id = candidateEnvironmentIdOf({ workstream: "tackle-factory", label: "spike" })
    const refused = await writeCandidateEnvironment({
      record: {
        version: 1,
        workstream: "tackle-factory",
        id,
        room: id,
        path: "/tmp/lanes/spike",
        branch: "candidate/tackle-factory/spike",
        head: SHA,
        label: "spike",
        // SAFETY: the refusal under test is a state the schema does not name.
        state: "abandoned" as unknown as "open",
        createdAt: "2026-11-23T10:00:00.000Z",
        at: "2026-11-23T10:00:00.000Z",
      },
      home,
    }).catch((cause: unknown) => cause)
    expect(refused).toBeInstanceOf(CandidateEnvironmentRefused)
    expect(existsSync(candidateEnvironmentFile({ id, home }))).toBe(false)
  }))

test("new checks out the workstream head on the candidate's own branch", () =>
  withHome(async (home) => {
    const repo = repository()
    try {
      mkdirSync(join(home, "workstreams"), { recursive: true })
      writeFileSync(
        join(home, "workstreams", "tackle-factory.json"),
        JSON.stringify(
          workstreamRecord({ id: "tackle-factory", path: repo.path, head: repo.head }),
          null,
          2,
        ) + "\n",
      )
      const roomRoot = join(home, "room")
      const created = await createCandidateEnvironment({
        workstream: "tackle-factory",
        label: "spike",
        roomRoot,
        home,
        at: "2026-11-23T10:00:00.000Z",
      })
      expect(created.state).toBe("open")
      expect(created.head).toBe(repo.head)
      expect(created.branch).toBe("candidate/tackle-factory/spike")
      expect(created.path).toBe(join(roomRoot, created.id, "worktree"))
      expect(existsSync(join(created.path, ".git"))).toBe(true)
      // The room is the same room the board already scans, so its lease and service need no
      // second reader.
      expect(existsSync(join(roomRoot, created.room, "room.json"))).toBe(true)
      const branch = execFileSync("git", ["-C", created.path, "symbolic-ref", "--short", "HEAD"], {
        encoding: "utf8",
      }).trim()
      expect(branch).toBe(created.branch)
    } finally {
      rmSync(repo.path, { recursive: true, force: true })
    }
  }))

test("new refuses a workstream the factory does not hold", () =>
  withHome(async (home) => {
    const refused = await createCandidateEnvironment({
      workstream: "nobody",
      label: "spike",
      roomRoot: join(home, "room"),
      home,
    }).catch((cause: unknown) => cause)
    expect(refused).toBeInstanceOf(CandidateEnvironmentRefused)
    expect((refused as CandidateEnvironmentRefused).detail).toBe("WorkstreamNotFound")
  }))
