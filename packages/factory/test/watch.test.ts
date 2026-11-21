import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { recordOf, type Workstream } from "../src/store.ts"
import { shouldWake, type WatchEvent } from "../src/watch.ts"

/* oxlint-disable plumb/prefer-property-tests, no-reinterpret-cast, require-safety-comment-for-type-assertion -- the fixtures are trusted local JSON and the test shape is the assertion. */

const fixture = <A>(name: string): A =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL("./fixtures/" + name, import.meta.url)), "utf8"),
  ) as A

const base = (): Workstream =>
  recordOf({
    id: "perms-1862",
    facts: {
      project: "P-AUT-128",
      label: "permissions-overhaul",
      repo: "Shakti-Reforestation/forestbuilder",
      path: "/tmp/perms",
      branch: "feature/permissions-overhaul",
      head: "55aa5293a4b9d0f7f0e1c1b6a1f0d3c8e7b6a5d4",
      pr: 1862,
      base: "develop",
      baseSha: "6e4f4ffc8",
      prHead: "55aa5293a4b9d0f7f0e1c1b6a1f0d3c8e7b6a5d4",
      phase: "build",
      at: "2026-11-21T22:00:00.000Z",
      checkpoint: { sha: "55aa5293a", ref: "refs/bench/perms-1862", at: "…", pushed: true },
    },
  })

type WakeFixture = {
  readonly cases: ReadonlyArray<{
    readonly name: string
    readonly given: {
      readonly workstream?: {
        readonly phase?: "blocked"
        readonly budget?: { readonly passes?: { readonly used: number; readonly of: number } }
      }
      readonly event: {
        readonly id: string
        readonly kind: string
        readonly at: string
        readonly headSha?: string
        readonly actor?: string
      }
    }
    readonly expected: { readonly wake: boolean }
  }>
}

test("the six wake cases agree with the decision", () => {
  const data = fixture<WakeFixture>("watch/wake-cases.json")
  for (const item of data.cases) {
    const record =
      item.given.workstream?.phase === undefined
        ? base()
        : { ...base(), phase: item.given.workstream.phase }
    const event: WatchEvent = { ...item.given.event, payload: {} }
    const decision = shouldWake({
      record,
      event,
      consumed: ["github:review-comment:2048113377"],
      passesUsed: item.given.workstream?.budget?.passes?.used ?? 0,
    })
    expect(decision.wake, item.name).toBe(item.expected.wake)
  }
})

test("Linear offsets normalize to instants, so the same cursor returns the same new events", () => {
  const data = fixture<{
    readonly events: ReadonlyArray<{ readonly id: string; readonly updatedAt: string }>
    readonly cases: ReadonlyArray<{
      readonly cursor: string
      readonly mustReturn: ReadonlyArray<string>
    }>
  }>("cursor/linear.offset-pair.json")
  const byId = new Map(data.events.map((event) => [event.id, event]))
  for (const item of data.cases) {
    const cursor = byId.get(item.cursor)
    expect(cursor, item.cursor).toBeDefined()
    if (cursor === undefined) continue
    const since = Date.parse(cursor.updatedAt)
    const after = data.events
      .filter((event) => Date.parse(event.updatedAt) > since)
      .map((e) => e.id)
    expect(after, item.cursor).toEqual(item.mustReturn)
  }
})
