/* oxlint-disable plumb/prefer-property-tests -- fixed temporary workstream and two shell gates. */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { listDesk } from "../src/factory/desk.ts"
import { readEvents } from "../src/factory/events.ts"
import { runReady } from "../src/factory/ready.ts"
import { readWorkstream, recordOf, writeWorkstream } from "../src/factory/store.ts"

const fixture = async (command: string) => {
  const root = mkdtempSync(join(tmpdir(), "factory-ready-"))
  const home = join(root, "home")
  const record = recordOf({
    id: "probe-1",
    facts: {
      project: "P-AUT-1",
      label: "probe",
      repo: "acme/probe",
      path: root,
      branch: "feature/probe",
      head: "a".repeat(40),
      delivery: "pr",
      pr: 1,
      base: "main",
      baseSha: "b".repeat(40),
      prHead: "a".repeat(40),
      phase: "compress",
      at: "2026-11-24T00:00:00.000Z",
      checkpoint: {
        sha: "a".repeat(40),
        ref: "refs/bench/probe-1",
        at: "2026-11-24T00:00:00.000Z",
        pushed: true,
      },
    },
  })
  await writeWorkstream({
    home,
    record: {
      ...record,
      gates: { perPass: [], onReady: [{ name: "probe", command }] },
    },
  })
  const receipts = join(home, "workstreams", "probe-1.receipts")
  mkdirSync(receipts, { recursive: true })
  writeFileSync(
    join(receipts, "0001.json"),
    JSON.stringify({
      workstream: "probe-1",
      pass: 1,
      at: "2026-11-24T00:00:30.000Z",
      status: "done",
      phase: "compress",
      events: [],
      checkpoint: "a".repeat(40),
      exit: 0,
      compress: {
        findingsBefore: 10,
        findingsAfter: 7,
        consolidated: 2,
        deleted: 1,
        locNet: -20,
        effectBefore: { bespokeErrorUnion: 1, throwCount: 2, dateNow: 3, consoleLog: 4 },
        effectAfter: { bespokeErrorUnion: 0, throwCount: 1, dateNow: 2, consoleLog: 3 },
        ruleGaps: [],
      },
    }),
  )
  const gh = join(root, "gh")
  const body = [
    "## Summary",
    "A substantive handoff body that explains what ships and why.",
    "## The walkthrough",
    "The problems in the order they bit, and the decisions taken from the SOW.",
    "## For the code review",
    "The shape in five lines, and what was checked with real numbers.",
    "The recordings are attached to this description.",
    "Context: " + "the review evidence is written down here. ".repeat(40),
  ].join("\n")
  writeFileSync(
    gh,
    "#!/usr/bin/env node\nconsole.log(" + JSON.stringify(JSON.stringify({ body })) + ")\n",
  )
  chmodSync(gh, 0o755)
  return { root, home, gh }
}

test("a green landing gate moves to land and raises one ready desk", async () => {
  const f = await fixture("true")
  process.env.GH_BIN = f.gh
  try {
    const result = await runReady({ id: "probe-1", home: f.home, at: "2026-11-24T00:01:00.000Z" })
    expect(result.ok).toBe(true)
    expect((await readWorkstream({ id: "probe-1", home: f.home }))?.phase).toBe("land")
    expect((await listDesk({ home: f.home }))[0]?.title).toContain("Ready for review")
  } finally {
    delete process.env.GH_BIN
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("a red landing gate stays in build and queues a scoped fix task", async () => {
  const f = await fixture("exit 7")
  process.env.GH_BIN = f.gh
  try {
    const result = await runReady({ id: "probe-1", home: f.home, at: "2026-11-24T00:01:00.000Z" })
    expect(result.ok).toBe(false)
    expect((await readWorkstream({ id: "probe-1", home: f.home }))?.phase).toBe("compress")
    const events = await readEvents({ id: "probe-1", home: f.home })
    expect(events[0]?.kind).toBe("task")
    expect(events[0]?.payload).toMatchObject({ task: expect.stringContaining("exit 7") })
    expect(await listDesk({ home: f.home })).toEqual([])
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})
