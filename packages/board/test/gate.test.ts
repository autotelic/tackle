/* oxlint-disable plumb/prefer-property-tests -- three fixed on-disk gate states and one missing receipt; the fixtures are the property. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Activity } from "@autotelic/factory/activity"
import { expect, test } from "vitest"
import { workstreamsWithGates } from "../src/gate.ts"

const baseline = (identities: ReadonlyArray<string>): string =>
  JSON.stringify({ lexicon: { name: "baseline", version: 1 }, identities })

const checkout = (files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(join(tmpdir(), "board-gate-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

const activity = (input: {
  readonly workstream: string
  readonly quality?: { readonly errors: number; readonly warnings: number } | undefined
}): Activity => ({
  workstream: input.workstream,
  lastPass:
    input.quality === undefined
      ? null
      : {
          pass: 4,
          at: "2026-11-22T11:00:00.000Z",
          status: "done",
          phase: "build",
          events: [],
          checkpoint: undefined,
          exit: 0,
          quality: {
            before: { available: true, errors: 0, warnings: 0, note: "jig check" },
            after: { available: true, ...input.quality, note: "jig check" },
            regressed: false,
          },
        },
  pending: [],
  lastEvent: null,
  ageMinutes: 1,
  budget: { used: 1, passesPerPhase: 5 },
  phase: "build",
  state: "idle",
  blockedBy: [],
})

const serve = (path: string, at = "2026-11-22T12:00:00.000Z") =>
  workstreamsWithGates({
    workstreams: [{ id: "probe", repo: "autotelic/tackle", path }],
    activities: [activity({ workstream: "probe", quality: { errors: 2, warnings: 1 } })],
    observedAt: at,
  })

test("the gate counts the configured baseline and the newest pass", async () => {
  const path = checkout({
    "jig.config.json": JSON.stringify({
      engines: [],
      gate: { mode: "all", baseline: "tools/accepted.json" },
    }),
    "tools/accepted.json": baseline(["a", "b", "c"]),
  })
  try {
    const [served] = await serve(path)
    expect(served?.gate).toMatchObject({
      repo: "autotelic/tackle",
      path,
      observedAt: "2026-11-22T12:00:00.000Z",
      baseline: {
        state: "present",
        file: "tools/accepted.json",
        identities: 3,
        newestAccepted: null,
      },
      quality: { state: "measured", pass: 4, available: true, errors: 2, warnings: 1 },
    })
    expect(served?.gate.baseline.note).toContain("newest accepted is not recorded")
  } finally {
    rmSync(path, { recursive: true, force: true })
  }
})

test("a missing baseline is absent, and its count is null rather than zero", async () => {
  const path = checkout({})
  try {
    const [served] = await serve(path)
    expect(served?.gate.baseline).toMatchObject({ state: "absent", identities: null })
  } finally {
    rmSync(path, { recursive: true, force: true })
  }
})

test("a baseline that does not decode is unreadable, not empty", async () => {
  const path = checkout({ ".jig-baseline.json": "{ not a baseline" })
  try {
    const [served] = await serve(path)
    expect(served?.gate.baseline).toMatchObject({ state: "unreadable", identities: null })
  } finally {
    rmSync(path, { recursive: true, force: true })
  }
})

test("no pass means the quality is unmeasured, not zero", async () => {
  const path = checkout({})
  try {
    const [served] = await workstreamsWithGates({
      workstreams: [{ id: "probe", repo: "autotelic/tackle", path }],
      activities: [],
      observedAt: "2026-11-22T12:00:00.000Z",
    })
    expect(served?.gate.quality).toMatchObject({ state: "unmeasured" })
    if (served?.gate.quality.state === "unmeasured")
      expect(served.gate.quality.note).toContain("no pass has run")
  } finally {
    rmSync(path, { recursive: true, force: true })
  }
})
