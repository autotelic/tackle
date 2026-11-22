/* oxlint-disable plumb/prefer-property-tests -- the generated input space here is the store's schema, which the fixtures already decode; the interesting cases are the three freshness values and the boundary. */
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { recordOf } from "@autotelic/factory/store"
import { blockedByOf, enrichWorkstream, freshnessOf } from "../src/workstreams.ts"

const OBSERVED_AT = "2026-11-21T22:50:00.000Z"

const record = (id: string, phase: "reconcile" | "build" | "land" | "blocked" | "done") =>
  recordOf({
    id,
    facts: {
      project: "P-AUT-128",
      label: id,
      repo: "acme/web",
      path: "/work/" + id,
      branch: "feature/" + id,
      head: "55aa5293a4b9d0f7f0e1c1b6a1f0d3c8e7b6a5d4",
      delivery: "pr",
      pr: 1862,
      base: "develop",
      baseSha: "6e4f4ffc8",
      prHead: "55aa5293a4b9d0f7f0e1c1b6a1f0d3c8e7b6a5d4",
      phase,
      at: "2026-11-21T22:00:00.000Z",
      checkpoint: {
        sha: "55aa5293a",
        ref: "refs/bench/" + id,
        at: "2026-11-21T22:38:00.000Z",
        pushed: true,
      },
    },
  })

test("freshness is the three values, and an empty cursor is unobserved rather than stale", () => {
  expect(freshnessOf({ cursor: "2026-11-21T22:49:00.000Z", observedAt: OBSERVED_AT })).toBe("fresh")
  expect(freshnessOf({ cursor: "2026-11-21T22:20:00.000Z", observedAt: OBSERVED_AT })).toBe("stale")
  expect(freshnessOf({ cursor: "", observedAt: OBSERVED_AT })).toBe("unobserved")
  expect(freshnessOf({ cursor: undefined, observedAt: OBSERVED_AT })).toBe("unobserved")
  expect(freshnessOf({ cursor: "not an instant", observedAt: OBSERVED_AT })).toBe("unobserved")
})

test("blockedBy names only dependencies that have not reached done", () => {
  const open = { ...record("open", "build"), deps: ["done-one", "open-two", "missing-one"] }
  const done = { ...record("done-one", "done"), deps: [] }
  const building = { ...record("open-two", "build"), deps: [] }
  expect(blockedByOf({ record: open, records: [open, done, building] })).toEqual([
    "open-two",
    "missing-one",
  ])
})

test("enrichment carries observed instants, per-source freshness, budget and pass counts", () => {
  const workstream = {
    ...record("perms-1862", "build"),
    deps: ["integrations-1860"],
    cursors: {
      github: "2026-11-21T22:49:00.000Z",
      linear: "2026-11-21T22:20:00.000Z",
      reports: "",
    },
  }
  const enriched = enrichWorkstream({
    record: workstream,
    records: [workstream],
    observedAt: OBSERVED_AT,
    used: 3,
  })
  expect(enriched.observed).toEqual({
    github: "2026-11-21T22:49:00.000Z",
    linear: "2026-11-21T22:20:00.000Z",
    reports: null,
  })
  expect(enriched.freshnessBySource).toEqual({
    github: "fresh",
    linear: "stale",
    reports: "unobserved",
  })
  expect(enriched.freshness).toBe("stale")
  expect(enriched.blockedBy).toEqual(["integrations-1860"])
  expect(enriched.budget).toEqual({ passes: { used: 3, of: 5 }, capStop: null })
})

test("a used-up budget is a cap stop with its reason", () => {
  const workstream = record("enterprise-1854", "blocked")
  const enriched = enrichWorkstream({
    record: workstream,
    records: [workstream],
    observedAt: OBSERVED_AT,
    used: 5,
  })
  expect(enriched.budget.capStop).toBe("passes")
  expect(enriched.budget.passes).toEqual({ used: 5, of: 5 })
})

test("the board serves the panel's fields from /presence", () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
  const root = mkdtempSync(join(tmpdir(), "board-presence-"))
  const home = join(root, "factory")
  const workstreams = join(home, "workstreams")
  try {
    mkdirSync(join(workstreams, "perms-1862.receipts"), { recursive: true })
    for (const pass of ["0001", "0002", "0003"])
      writeFileSync(join(workstreams, "perms-1862.receipts", pass + ".json"), "{}")
    const base = record("perms-1862", "build")
    writeFileSync(
      join(workstreams, "perms-1862.json"),
      JSON.stringify({
        ...base,
        deps: ["integrations-1860"],
        cursors: {
          github: "2026-11-21T22:49:00.000Z",
          linear: "2026-11-21T22:20:00.000Z",
        },
        prState: "open",
        projectState: "started",
      }),
    )
    writeFileSync(
      join(workstreams, "integrations-1860.json"),
      JSON.stringify(record("integrations-1860", "build")),
    )
    const output = spawnSync(
      process.execPath,
      ["--conditions=development", cli, "presence", "--root", join(root, "rooms"), "--json"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          FACTORY_HOME: home,
          HERDR_BIN: "/bin/false",
          REX_BIN: "/bin/false",
        },
      },
    )
    expect(output.status, output.stderr).toBe(0)
    const presence = JSON.parse(output.stdout)
    const workstream = presence.factory.workstreams.find(
      (candidate: { readonly id: string }) => candidate.id === "perms-1862",
    )
    expect(workstream).toMatchObject({
      freshness: "stale",
      freshnessBySource: { github: "fresh", linear: "stale", reports: "unobserved" },
      observed: {
        github: "2026-11-21T22:49:00.000Z",
        linear: "2026-11-21T22:20:00.000Z",
        reports: null,
      },
      blockedBy: ["integrations-1860"],
      budget: { passes: { used: 3, of: 5 }, capStop: null },
      prState: "open",
      projectState: "started",
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
