/* oxlint-disable plumb/prefer-property-tests -- fixed factory-home fixtures, one wait each. */
import { expect, test } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { attentionOf, servedStatus, waitForAttention } from "../src/factory/attention.ts"

const started = Date.parse("2026-11-28T00:00:00.000Z")

const record = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  id: "tech-seams",
  project: "tackle",
  label: "tech-seams",
  repo: "autotelic/tackle",
  path: "/tmp/tech-seams",
  branch: "factory/tech-seams",
  head: "0".repeat(40),
  delivery: "trunk",
  base: "factory/tech-seams",
  baseSha: "0".repeat(40),
  prHead: "0".repeat(40),
  diverged: false,
  phase: "build",
  deps: [],
  lease: { holder: "test", generation: 1 },
  cursors: { github: "", linear: "" },
  budgets: { passesPerPhase: 5, wallMinutesPerPass: 30, tokensPerDay: 0, roundsOfChanges: 2 },
  autonomy: [],
  desk: [],
  checkpoint: {
    sha: "0".repeat(40),
    ref: "refs/bench/tech-seams",
    at: "2026-11-28T00:00:00.000Z",
    pushed: false,
  },
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
  ...over,
})

const writeRecord = (home: string, value: Record<string, unknown>): void => {
  writeFileSync(
    join(home, "workstreams", String(value["id"]) + ".json"),
    JSON.stringify(value, null, 2) + "\n",
  )
}

const writeDesk = (home: string, item: Record<string, unknown>): void => {
  mkdirSync(join(home, "desk"), { recursive: true })
  writeFileSync(join(home, "desk", String(item["id"]) + ".json"), JSON.stringify(item))
}

const withHome = async (body: (home: string) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "factory-wait-"))
  const home = join(root, "home")
  mkdirSync(join(home, "workstreams"), { recursive: true })
  writeRecord(home, record())
  try {
    await body(home)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const snapshot = (directory: string): Record<string, string> => {
  const files: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else files[path] = readFileSync(path, "utf8")
    }
  }
  walk(directory)
  return files
}

test("an idle wait backs off a minute at a time, capped at half an hour", async () => {
  await withHome(async (home) => {
    let clock = started
    const intervals: Array<number> = []
    const result = await waitForAttention({
      seconds: 7200,
      home,
      now: () => clock,
      sleep: async (ms) => {
        intervals.push(ms)
        clock += ms
      },
      // No watcher: this is the case the backoff exists for.
      watch: () => () => {},
    })
    expect(result.changed).toBe(false)
    expect(intervals.slice(0, 5)).toEqual([60_000, 120_000, 240_000, 480_000, 960_000])
    expect(Math.max(...intervals)).toBe(1_800_000)
    expect(intervals.filter((ms) => ms === 1_800_000)).toHaveLength(2)
    // Every sleep is bounded by what is left of the wait, so the last one is the remainder.
    expect(intervals.reduce((total, ms) => total + ms, 0)).toBe(7_200_000)
    expect(result.waitedMs).toBe(7_200_000)
    expect(result.polls).toBe(intervals.length + 1)
  })
})

test("a pass that ends while the wait sleeps returns on the change", async () => {
  await withHome(async (home) => {
    const clock = started
    const endedAt = new Date(started + 5_000).toISOString()
    const result = await waitForAttention({
      seconds: 3600,
      home,
      now: () => clock,
      sleep: async () => {
        // A pass finished and wrote its record while the chief was asleep.
        writeRecord(home, record({ phase: "land", updatedAt: endedAt }))
      },
      watch: () => () => {},
    })
    expect(result.changed).toBe(true)
    expect(result.status.rows[0]?.record.phase).toBe("land")
    expect(result.status.rows[0]?.record.updatedAt).toBe(endedAt)
    // One interval was scheduled; the read after it is what returned, not the timeout.
    expect(result.intervals).toHaveLength(1)
    expect(result.polls).toBe(2)
  })
})

test("a watched write aborts the sleep instead of waiting out the interval", async () => {
  await withHome(async (home) => {
    const clock = started
    let wake: (() => void) | null = null
    let aborted = false
    const result = await waitForAttention({
      seconds: 3600,
      home,
      now: () => clock,
      // The watcher is armed before the first read, so nothing written after it is missed.
      watch: (notify) => {
        wake = notify
        return () => {
          wake = null
        }
      },
      sleep: (_ms, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true
              resolve()
            },
            { once: true },
          )
          // A desk item lands while the chief sleeps; the watcher aborts the sleep.
          writeDesk(home, {
            id: "desk-tech-seams-1",
            workstream: "tech-seams",
            kind: "decision",
            title: "Land it?",
            body: "",
            choices: ["accept"],
            route: "live",
            at: new Date(started + 1_000).toISOString(),
          })
          wake?.()
        }),
    })
    expect(aborted).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.waitedMs).toBe(0)
    expect(result.status.desk.map((item) => item.id)).toEqual(["desk-tech-seams-1"])
  })
})

test("a wake that changes nothing does not skip the backoff", async () => {
  await withHome(async (home) => {
    let clock = started
    const intervals: Array<number> = []
    const result = await waitForAttention({
      seconds: 200,
      home,
      now: () => clock,
      // A write lands before the first read. The wait must read again and then sleep its
      // first interval, not jump straight to the second one.
      watch: (notify) => {
        notify()
        return () => {}
      },
      sleep: async (ms) => {
        intervals.push(ms)
        clock += ms
      },
    })
    expect(result.changed).toBe(false)
    expect(intervals).toEqual([60_000, 120_000, 20_000])
  })
})

test("a bounded wait stops at its deadline and reports no change", async () => {
  await withHome(async (home) => {
    let clock = started
    const intervals: Array<number> = []
    const result = await waitForAttention({
      seconds: 90,
      home,
      now: () => clock,
      sleep: async (ms) => {
        intervals.push(ms)
        clock += ms
      },
      watch: () => () => {},
    })
    expect(result.changed).toBe(false)
    expect(intervals).toEqual([60_000, 30_000])
    expect(result.waitedMs).toBe(90_000)
    expect(result.polls).toBe(3)
    // The deadline is never overshot, even when the backoff has grown past it.
    expect(result.waitedMs).toBeLessThanOrEqual(90_000)
  })
})

test("waiting writes nothing", async () => {
  await withHome(async (home) => {
    writeDesk(home, {
      id: "desk-tech-seams-open",
      workstream: "tech-seams",
      kind: "decision",
      title: "One open question",
      body: "",
      choices: ["accept", "decline"],
      route: "live",
      at: new Date(started - 60_000).toISOString(),
    })
    let clock = started
    const before = snapshot(home)
    await waitForAttention({
      seconds: 300,
      home,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
      watch: () => () => {},
    })
    const after = snapshot(home)
    expect(after).toEqual(before)
  })
})

test("a raised desk item is a change in attention", async () => {
  await withHome(async (home) => {
    const before = attentionOf(await servedStatus({ home, now: started }))
    writeDesk(home, {
      id: "desk-tech-seams-2",
      workstream: "tech-seams",
      kind: "decision",
      title: "Land it?",
      body: "",
      choices: ["accept"],
      route: "live",
      at: new Date(started + 1_000).toISOString(),
    })
    const after = attentionOf(await servedStatus({ home, now: started }))
    expect(after).not.toBe(before)
  })
})
