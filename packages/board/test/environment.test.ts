/* oxlint-disable plumb/prefer-property-tests -- the property is "every workstream gets one environment"; the named cases pin the four facts it must not invent. */
import type { Session } from "../src/sessions.ts"
import type { Tailnet } from "../src/tailnet.ts"
import { expect, test } from "vitest"
import { environmentsOf } from "../src/environment.ts"

const at = "2026-11-22T12:00:00.000Z"

const tailnet = (self?: { readonly host: string; readonly dnsName?: string }): Tailnet => ({
  available: true,
  state: "Running",
  self:
    self === undefined
      ? undefined
      : { host: self.host, dnsName: self.dnsName, online: true, os: "macOS", ips: ["100.64.0.1"] },
  peers: [],
})

const session = (input: {
  readonly address: string
  readonly status: string
  readonly workstream?: string
}): Session => {
  const live: Session = {
    source: "herdr",
    address: input.address,
    agent: "claude",
    cwd: undefined,
    state: "idle",
    status: input.status,
    turn: 3,
    where: "factory",
  }
  // exactOptionalPropertyTypes: an absent join is an absent key, not a present undefined.
  return input.workstream === undefined ? live : { ...live, workstream: input.workstream }
}

const serve = (input: {
  readonly workstreams?: ReadonlyArray<{ readonly id: string; readonly path: string }>
  readonly sessions?: ReadonlyArray<Session>
  readonly tailnet?: Tailnet
}) =>
  environmentsOf({
    workstreams: input.workstreams ?? [{ id: "shakti-perms", path: "/Users/togmund/shakti-perms" }],
    sessions: input.sessions ?? [],
    tailnet: input.tailnet ?? tailnet({ host: "macbook-pro", dnsName: "macbook-pro.tail.ts.net" }),
    observedAt: at,
  })

test("every workstream gets one environment, in record order", () => {
  const served = serve({
    workstreams: [
      { id: "second", path: "/tmp/second" },
      { id: "first", path: "/tmp/first" },
    ],
  })
  expect(served.map((environment) => environment.workstream)).toEqual(["second", "first"])
})

test("a workstream with no service declaration serves no services and no agent or preview", () => {
  const [served] = serve({})
  expect(served).toEqual({
    workstream: "shakti-perms",
    machine: { host: "macbook-pro", dnsName: "macbook-pro.tail.ts.net" },
    runtime: { kind: "worktree", path: "/Users/togmund/shakti-perms" },
    services: [],
    agent: null,
    preview: null,
    observedAt: at,
  })
})

test("a matched session fills the agent, and one tagged elsewhere does not", () => {
  const [served] = serve({
    sessions: [
      session({ address: "t1d", status: "idle", workstream: "other" }),
      session({ address: "t19", status: "working", workstream: "shakti-perms" }),
    ],
  })
  expect(served?.agent).toEqual({ session: "t19", status: "working" })
})

test("no tailnet self means no machine, never a guessed hostname", () => {
  const [served] = serve({ tailnet: tailnet() })
  expect(served?.machine).toBeNull()
  // The rest of the environment is still served: a missing machine may not hide the runtime.
  expect(served?.runtime).toEqual({ kind: "worktree", path: "/Users/togmund/shakti-perms" })
})
