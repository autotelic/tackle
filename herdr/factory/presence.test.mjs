/* oxlint-disable plumb/prefer-property-tests -- four fixed served documents; the shape, not a
   generated claim, is what these pin. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { environmentText, metaLine, readPresence } from "./presence.js"

// The seam is bytes and the board owns them, so these cases start from the document the board
// serves and read the model the panel draws. A test that handed over an already-shaped value
// would skip the half of the path that changes when the board does.

const workstream = (id) => ({
  id,
  project: "factory",
  label: id,
  phase: "build",
  path: "/Users/togmund/autotelic/" + id,
  checkpoint: { sha: "0".repeat(40), at: "2026-11-22T10:00:00.000Z" },
})

const presence = ({ environments } = {}) => {
  const factory = {
    workstreams: [workstream("shakti-perms")],
    activity: [
      {
        workstream: "shakti-perms",
        lastPass: null,
        pending: [],
        lastEvent: null,
        ageMinutes: null,
        budget: { used: 0, passesPerPhase: 20 },
        phase: "build",
        state: "working",
        blockedBy: [],
      },
    ],
    desk: [],
    reports: [],
  }
  // A board that serves no environments omits the key; the property is added only when the
  // case has one, so the absent case is a real absence rather than an undefined value.
  if (environments !== undefined) factory.environments = environments
  return {
    factory,
    sessions: {
      herdr: { available: false, sessions: [] },
      rex: { available: false, sessions: [] },
    },
  }
}

const environment = {
  workstream: "shakti-perms",
  machine: { host: "macbook-pro", dnsName: "macbook-pro.tail.ts.net" },
  runtime: { kind: "worktree", path: "/Users/togmund/autotelic/shakti-perms" },
  services: [],
  agent: { session: "t19", status: "working" },
  preview: null,
  observedAt: "2026-11-22T12:00:00.000Z",
}

test("the environment line draws machine, runtime, services and preview", () => {
  const [row] = readPresence(presence({ environments: [environment] })).rows
  assert.equal(row.machine, "macbook-pro")
  assert.equal(row.agent, "working")
  assert.equal(environmentText(row), "macbook-pro · worktree /Users/togmund/autotelic/shakti-perms")
})

test("a workstream with no declared service and no preview draws no service or preview text", () => {
  const [row] = readPresence(presence({ environments: [environment] })).rows
  assert.deepEqual(row.services, [])
  assert.equal(row.preview, null)
  assert.equal(environmentText(row).includes("null"), false)
})

test("a board that serves no environments still reads, and draws no environment line", () => {
  const [row] = readPresence(presence()).rows
  assert.equal(environmentText(row), "")
  assert.deepEqual(row.services, [])
  // The row itself is untouched: a missing field may not hide the workstream.
  assert.equal(row.label, "shakti-perms")
  assert.equal(metaLine(row), "0/20")
})

test("a half-served environment keeps its missing parts missing", () => {
  const [row] = readPresence(presence({ environments: [{ workstream: "shakti-perms" }] })).rows
  assert.equal(row.machine, null)
  assert.equal(row.runtime, null)
  assert.equal(row.agent, null)
  assert.equal(row.preview, null)
  assert.equal(environmentText(row), "")
})

test("a null machine and a null agent draw nothing, and the session join is the fallback", () => {
  const document = presence({
    environments: [{ workstream: "shakti-perms", machine: null, agent: null }],
  })
  document.sessions.herdr.sessions = [
    { source: "herdr", address: "t19", status: "working", workstream: "shakti-perms" },
  ]
  const [row] = readPresence(document).rows
  assert.equal(row.machine, null)
  assert.equal(row.agent, "working")
  assert.equal(row.address, "t19")
})
