/* oxlint-disable plumb/prefer-property-tests -- four fixed served documents; the shape, not a
   generated claim, is what these pin. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { candidateText, environmentText, metaLine, readPresence } from "./presence.js"

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

const presence = ({ environments, candidates } = {}) => {
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
  if (candidates !== undefined) factory.candidates = candidates
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
  port: { room: "shakti-perms-dev", number: 4400, leasedAt: "2026-11-22T11:00:00.000Z" },
  services: [],
  agent: { session: "t19", status: "working" },
  preview: null,
  observedAt: "2026-11-22T12:00:00.000Z",
}

test("an idle row carries the PR and age the panel uses for its review action", () => {
  const doc = presence()
  doc.factory.workstreams[0].repo = "Shakti-Reforestation/forestbuilder"
  doc.factory.workstreams[0].pr = 1874
  doc.factory.workstreams[0].phase = "land"
  doc.factory.activity[0].state = "idle"
  doc.factory.activity[0].ageMinutes = 90
  const [row] = readPresence(doc).rows
  assert.equal(row.repo, "forestbuilder")
  assert.equal(row.repoFull, "Shakti-Reforestation/forestbuilder")
  assert.equal(row.pr, 1874)
  assert.equal(row.phase, "land")
  assert.equal(row.ageMinutes, 90)
})

test("a stored worker is drawn in the meta line", () => {
  const doc = presence()
  doc.factory.workstreams[0].worker = "intercom:t19"
  const [row] = readPresence(doc).rows
  assert.equal(row.worker, "intercom:t19")
  assert.match(metaLine(row), /worker intercom:t19/)
})

test("the environment line draws machine, runtime, services and preview", () => {
  const [row] = readPresence(presence({ environments: [environment] })).rows
  assert.equal(row.machine, "macbook-pro")
  assert.equal(row.agent, "working")
  assert.equal(
    environmentText(row),
    "macbook-pro · worktree /Users/togmund/autotelic/shakti-perms · port 4400",
  )
})

test("a workstream with no declared service and no preview draws no service or preview text", () => {
  const [row] = readPresence(presence({ environments: [environment] })).rows
  assert.deepEqual(row.services, [])
  assert.equal(row.preview, null)
  assert.equal(environmentText(row).includes("null"), false)
})

test("a served preview is drawn, and a null one draws nothing", () => {
  const withPreview = { ...environment, preview: "/preview/shakti-perms/" }
  const [served] = readPresence(presence({ environments: [withPreview] })).rows
  assert.equal(served.preview, "/preview/shakti-perms/")
  assert.equal(environmentText(served).endsWith("/preview/shakti-perms/"), true)
  const [nullPreview] = readPresence(presence({ environments: [environment] })).rows
  assert.equal(nullPreview.preview, null)
  assert.equal(environmentText(nullPreview).includes("/preview/"), false)
})

test("a workstream with no leased port draws no port text", () => {
  const [row] = readPresence(presence({ environments: [{ ...environment, port: null }] })).rows
  assert.equal(row.port, null)
  assert.equal(environmentText(row).includes("port"), false)
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

/** One candidate lane as the board serves it. */
const lane = {
  workstream: "shakti-perms",
  id: "shakti-perms-spike",
  room: "shakti-perms-spike",
  path: "/Users/togmund/autotelic/.room/shakti-perms-spike/worktree",
  branch: "candidate/shakti-perms/spike",
  head: "1".repeat(40),
  label: "spike",
  state: "open",
  runtime: { kind: "worktree", path: "/Users/togmund/autotelic/.room/shakti-perms-spike/worktree" },
  port: { room: "shakti-perms-spike", number: 4401, leasedAt: "2026-11-22T11:00:00.000Z" },
  services: [],
  preview: "/preview/shakti-perms-spike/",
  observedAt: "2026-11-22T12:00:00.000Z",
}

test("two open candidates are two entries in the row's lane line", () => {
  const second = {
    ...lane,
    id: "shakti-perms-probe",
    room: "shakti-perms-probe",
    label: "probe",
    port: null,
    preview: null,
  }
  const [row] = readPresence(presence({ candidates: [lane, second] })).rows
  assert.deepEqual(
    row.candidates.map((entry) => [entry.id, entry.state, entry.preview]),
    [
      ["shakti-perms-spike", "open", "/preview/shakti-perms-spike/"],
      ["shakti-perms-probe", "open", null],
    ],
  )
  assert.equal(candidateText(row), "spike open · probe open")
})

test("a dropped candidate folds into one count and keeps its name", () => {
  const dropped = { ...lane, id: "shakti-perms-old", label: "old", state: "dropped", preview: null }
  const [row] = readPresence(presence({ candidates: [lane, dropped] })).rows
  assert.equal(candidateText(row), "spike open · 1 dropped")
})

test("a board that serves no candidates draws no lane line", () => {
  const [row] = readPresence(presence()).rows
  assert.deepEqual(row.candidates, [])
  assert.equal(candidateText(row), "")
  // The row itself is untouched: a missing field may not hide a workstream.
  assert.equal(row.label, "shakti-perms")
})

test("a half-served candidate keeps its missing parts missing", () => {
  const [row] = readPresence(
    presence({
      candidates: [{ workstream: "shakti-perms", id: "shakti-perms-spike", state: "open" }],
    }),
  ).rows
  assert.deepEqual(row.candidates, [
    {
      id: "shakti-perms-spike",
      label: "shakti-perms-spike",
      state: "open",
      branch: null,
      port: null,
      preview: null,
    },
  ])
  assert.equal(candidateText(row), "shakti-perms-spike open")
})

test("a candidate naming another workstream never joins this row", () => {
  const [row] = readPresence(
    presence({ candidates: [{ ...lane, workstream: "enterprise-1854" }] }),
  ).rows
  assert.deepEqual(row.candidates, [])
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
