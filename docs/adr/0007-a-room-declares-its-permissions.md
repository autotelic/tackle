# ADR 0007 — a room declares its guest's reach, and the record says what the runtime cannot

Status: accepted
Date: 2026-11-29

## Context

`createAgentOsRoom` (`packages/room/src/AgentOs.ts`) created every VM with no `permissions`
option, so each room ran on the sidecar's default sandbox policy (`AgentOsOptions.permissions`,
`agent-os.d.ts:474`, with the default described at `:468`–`:473`). Nothing in the repo said what
a room's guest could reach, so nothing could be read back: `/presence` and `room status` could
name a room's software but not its network. That is cut 4 of `docs/tech-seams.md` §3, whose
premise was that `AgentOsSidecar.describe()` (`:898`) could report the active policy.

## What 0.4.9 can express, and what it cannot

Read from `@rivet-dev/agentos-core@0.4.9`'s declarations and from the option schema the sidecar
validates (`dist/options-schema.d.ts`):

- **Expressible.** `AgentOsOptions.permissions` takes `Permissions` (`runtime-compat.d.ts:186`),
  six scopes — `fs`, `network`, `childProcess`, `process`, `env`, `hostFunction` — each either a
  bare mode or a rule set. A mode is `"allow" | "deny"` (`runtime.d.ts:3`); the generated type also
  names `"ask"` (`generated/PermissionMode.d.ts`), but the schema the sidecar enforces accepts only
  the two, so `"ask"` is not usable and is not written.
- **Not in the declarations.** A rule's `operations` are not written down anywhere in the pin.
  They are the operation table compiled into the sidecar: the 0.4.9 binary carries
  `network.fetch`, `network.http`, `network.dns` and `network.listen` beside `child_process.spawn`
  and `fs.read`. A rule's `patterns` match the host of the request (`NetworkAccessRequest` carries
  `host`, `port`, `protocol`, `url`: `runtime.d.ts:59`–`:64`).
- **Gap 1 — `describe()` is not a policy report.** `AgentOsSidecarDescription`
  (`agent-os.d.ts:176`–`:181`) is exactly `sidecarId`, `placement`, `state`, `activeVmCount`. There
  is no permissions member, so `describe()` cannot answer "what may this room reach". The cut's
  premise holds only for the declaration half.
- **Gap 2 — the listener policy is not on `AgentOsOptions`.** Port range and privileged binds are
  `CreateVmConfig.listen` (`generated/CreateVmConfig.d.ts:24`, type `VmListenPolicyConfig`), which
  is the internal create-VM JSON. `AgentOsOptions` (`agent-os.d.ts:391`–`:489`) exposes no
  `listen`, so a room cannot narrow the port range through this API. What it _can_ declare is
  whether the guest may listen at all: `network.listen` is an operation in the network scope.

## Decision

1. `packages/room/src/VmPermissions.ts` declares one policy, `roomVmPermissions`, and
   `createAgentOsRoom` passes it as `AgentOsOptions.permissions`. Only `network` is declared: the
   other scopes are merged over the sidecar's default, so naming them would restate the runtime
   rather than decide anything about a room.
2. The network scope is **deny by default**, then two allowances: `network.listen` with no pattern
   (a room's service _is_ a listener, and the runtime already refuses a non-loopback bind), and
   `network.fetch`/`network.http`/`network.dns` restricted to `127.0.0.1`, `localhost`, `::1`.
   Every external host — including the model-API hosts the sidecar's own default allowlist grants
   — is refused. A room that needs more says so here, with the test that proves it.
3. The boot records `runtime.permissions` in `room.json` (and, for the supervisor's own file,
   `vm.json`) as `{ declared, network, sidecar }`. `declared` names the scopes the room set, so a
   reader can tell a declaration from the sidecar's default without assuming. `sidecar` is
   `describe()` narrowed to what JSON can hold — `placement` is a kind plus pool, because the
   `explicit` variant carries a live handle (`agent-os.d.ts:172`–`:175`).
4. The record is honest about the gap: `network` is the room's declaration and `sidecar` is the
   runtime's identity/state. Nothing in the record claims the runtime confirmed the policy, because
   at 0.4.9 it cannot.
5. `room status` prints the line from `permissionsLine`, and a record without one prints nothing.
   A room file or run file written before this cut decodes unchanged with no permission field: the
   decoder is optional and the renderer's empty answer is the environment-plan rule, not a guess.

## Consequences

- The guest's reach is a fact of the code, not of Core's release: a Core default that widened the
  network allowlist would not reach a room.
- A room service still works end to end: the guest binds a loopback port, and the host bridge
  (`vm.network.httpRequest`) and an in-guest fetch to that port are both inside the policy.
- A guest that needs the network outside loopback fails at
  `packages/room/test/vm-permissions.test.ts` until the allowlist grows — the test asserts the
  failure, so it is the record that the policy is doing something.
- When a later Core exposes the policy on `describe()`, `SidecarDescription` grows that member and
  the record starts carrying the runtime's answer beside the declaration. Until then, no member is
  invented.
- `listen` (`portMin`/`portMax`/`allowPrivileged`) stays unreachable until Core puts it on
  `AgentOsOptions`; this ADR deliberately does not reach through to the sidecar's create-VM JSON.
