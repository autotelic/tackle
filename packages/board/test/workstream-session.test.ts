import { Option } from "effect"
import { expect, test } from "vitest"
import { workstreamFor, type Session } from "../src/sessions.ts"

const sessions = (overrides: Partial<Session>): Session => ({
  source: "herdr",
  address: "t1",
  agent: "pi",
  cwd: "/Users/togmund/autotelic/tackle",
  state: "live",
  status: "done",
  turn: 1,
  where: "tackle / tackle",
  ...overrides,
})

const workstreams = [
  {
    id: "tackle-factory",
    label: "factory-feedback",
    repo: "autotelic/tackle",
    path: "/Users/togmund/autotelic/tackle",
    project: "factory",
  },
]

test("only an explicit workstream label joins a session", () => {
  expect(Option.isNone(workstreamFor(sessions({}), workstreams))).toBe(true)
  expect(
    Option.getOrUndefined(
      workstreamFor(sessions({ labels: { workstream: "tackle-factory" } }), workstreams),
    ),
  ).toBe("tackle-factory")
})

test("cwd and tab words do not select a workstream", () => {
  expect(Option.isNone(workstreamFor(sessions({ where: "factory / tackle" }), workstreams))).toBe(
    true,
  )
})
