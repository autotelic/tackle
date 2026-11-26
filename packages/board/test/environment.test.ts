/* oxlint-disable plumb/prefer-property-tests -- the property is "every workstream gets one environment"; the named cases pin the four facts it must not invent. */
import type { Session } from "../src/sessions.ts"
import type { Tailnet } from "../src/tailnet.ts"
import { expect, test } from "vitest"
import {
  environmentsOf,
  type RoomPortLease,
  type RoomServiceObservation,
  type RoomVmPreview,
} from "../src/environment.ts"

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
  readonly leases?: ReadonlyArray<RoomPortLease>
  readonly services?: ReadonlyArray<RoomServiceObservation>
  readonly vmPreviews?: ReadonlyArray<RoomVmPreview>
}) =>
  environmentsOf({
    workstreams: input.workstreams ?? [{ id: "shakti-perms", path: "/Users/togmund/shakti-perms" }],
    sessions: input.sessions ?? [],
    tailnet: input.tailnet ?? tailnet({ host: "macbook-pro", dnsName: "macbook-pro.tail.ts.net" }),
    leases: input.leases,
    services: input.services,
    vmPreviews: input.vmPreviews,
    observedAt: at,
  })

/** One probe's result, named by the worktree the room owns. */
const observed = (input: {
  readonly worktree: string
  readonly status?: "healthy" | "unhealthy" | "stopped"
  readonly detail?: string
}): RoomServiceObservation => ({
  name: "web",
  command: "pnpm dev",
  port: 4400,
  healthPath: "/healthz",
  status: input.status ?? "healthy",
  detail:
    input.detail ?? (input.status === "stopped" ? "no supervisor is running for this room" : null),
  checkedAt: at,
  worktree: input.worktree,
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
    port: null,
    services: [],
    agent: null,
    preview: null,
    observedAt: at,
  })
})

test("a VM service advertises the board preview route without a host port", () => {
  const [served] = serve({
    workstreams: [{ id: "dev", path: "/tmp/dev" }],
    vmPreviews: [{ worktree: "/tmp/dev", room: "dev", port: 4819 }],
  })
  if (served === undefined) throw new Error("no environment")
  expect(served.preview).toBe("/preview/dev/")
  expect(served.port).toBe(null)
  expect(served.services).toEqual([])
})

test("a room lease fills the port for the workstream whose worktree it names", () => {
  const [served] = serve({
    leases: [
      {
        worktree: "/Users/togmund/shakti-perms",
        room: "shakti-perms-dev",
        number: 4400,
        leasedAt: at,
      },
    ],
  })
  expect(served?.port).toEqual({ room: "shakti-perms-dev", number: 4400, leasedAt: at })
})

test("a lease for another worktree, or for no existing worktree, fills no port", () => {
  const [served] = serve({
    leases: [{ worktree: "/Users/togmund/other", room: "other", number: 4401, leasedAt: at }],
  })
  expect(served?.port).toBeNull()
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

test("a declared service is served with the status the probe observed", () => {
  const [served] = serve({
    services: [observed({ worktree: "/Users/togmund/shakti-perms" })],
  })
  // The worktree is the join's evidence, so it is not a served field: a reader of the document
  // gets the declaration and the observation, and learns the path from `runtime`.
  expect(served?.services).toEqual([
    {
      name: "web",
      command: "pnpm dev",
      port: 4400,
      healthPath: "/healthz",
      status: "healthy",
      detail: null,
      checkedAt: at,
    },
  ])
})

test("a healthy service exposes the board's stable preview route", () => {
  const [served] = serve({
    services: [observed({ worktree: "/Users/togmund/shakti-perms" })],
  })
  expect(served?.preview).toBe("/preview/shakti-perms/")
})

test("an unhealthy or stopped service advertises no preview", () => {
  for (const status of ["unhealthy", "stopped"] as const) {
    const [served] = serve({
      services: [observed({ worktree: "/Users/togmund/shakti-perms", status })],
    })
    // The service is still reported — it exists — but the route stays null because no probe saw
    // it answer. A preview that cannot be opened is not a preview.
    expect(served?.services).toHaveLength(1)
    expect(served?.preview).toBeNull()
  }
})

test("the preview names the workstream, so a new lease keeps the same route", () => {
  const preview = (number: number) =>
    serve({
      leases: [{ worktree: "/Users/togmund/shakti-perms", room: "room", number, leasedAt: at }],
      services: [observed({ worktree: "/Users/togmund/shakti-perms" })],
    })[0]?.preview
  expect(preview(4400)).toBe("/preview/shakti-perms/")
  expect(preview(4401)).toBe(preview(4400))
})

test("an unhealthy service keeps the evidence, and a stopped one is not healthy", () => {
  const [served] = serve({
    services: [
      observed({
        worktree: "/Users/togmund/shakti-perms",
        status: "unhealthy",
        detail: "HTTP 503",
      }),
      observed({ worktree: "/Users/togmund/shakti-perms", status: "stopped" }),
    ],
  })
  expect(served?.services.map((service) => [service.status, service.detail])).toEqual([
    ["unhealthy", "HTTP 503"],
    ["stopped", "no supervisor is running for this room"],
  ])
})

test("an observation for another worktree names no service here", () => {
  const [served] = serve({ services: [observed({ worktree: "/Users/togmund/other" })] })
  expect(served?.services).toEqual([])
})

test("no tailnet self means no machine, never a guessed hostname", () => {
  const [served] = serve({ tailnet: tailnet() })
  expect(served?.machine).toBeNull()
  // The rest of the environment is still served: a missing machine may not hide the runtime.
  expect(served?.runtime).toEqual({ kind: "worktree", path: "/Users/togmund/shakti-perms" })
})
