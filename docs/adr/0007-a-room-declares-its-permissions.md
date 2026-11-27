# ADR 0007 — a room cannot declare a listener policy at agentOS 0.4.9

Status: blocked
Date: 2026-11-29

## Context

Cut 4 of `docs/tech-seams.md` §3 asked a room to declare its guest's reach and to record what
the runtime confirmed. The first implementation declared a deny-by-default network policy with
allowances for `network.listen`, `network.fetch`, `network.http` and `network.dns`, and
recorded `AgentOsSidecar.describe()` beside it. Two facts in the pin invalidate that design.

- **`describe()` is not a policy report.** `AgentOsSidecarDescription`
  (`agent-os.d.ts:176`–`:181`) is `sidecarId`, `placement`, `state` and `activeVmCount`.
  It has no permissions member, so the record could only keep the room's declaration, not the
  runtime's confirmation.
- **An allow rule for `net.listen` does not reach a guest listener.** The operations a rule names
  are not in the declarations; they are the sidecar's compiled operation table. The 0.4.9 binary
  carries `net.listen`, `net.http_request`, `net.connect` and `net.http_listen`, not the
  `network.*` names the first implementation guessed. A probe with
  `{ network: { default: "deny", rules: [{ mode: "allow", operations: ["net.listen"] }] } }`
  still let the guest `node` process exit before binding. The same happened with
  `net.http_listen`, `net.reserve_tcp_port`, patterns `["**"]`, and both together.
  Only `{ network: { default: "allow", rules: [] } }` kept the listener alive.
- **The listener policy is not on `AgentOsOptions`.** Port range and privileged binds are
  `CreateVmConfig.listen` (`generated/CreateVmConfig.d.ts:24`, `VmListenPolicyConfig`), which
  is the internal create-VM JSON. `AgentOsOptions` (`agent-os.d.ts:391`–`:489`) exposes no
  `listen`.

## Decision

Do not ship the deny-by-default policy. A policy that breaks every room service is not a tighter
sandbox; it is a room that cannot run its own work. The default runtime policy stays in force, and
no `runtime.permissions` field is written, because there is no policy a room actually applied to
record.

The cut is recorded as blocked on Core:

1. `CreateVmConfig.listen` needs to be expressible through `AgentOsOptions.listen`, with the
   same loopback-only guarantee a room already relies on.
2. `AgentOsSidecarDescription` needs a permissions/policy member before a record can claim the
   runtime confirmed a declaration.
3. The operation names a rule accepts need to be declared, not discovered from the binary.

When those exist, the room can declare a listener allowance and a loopback fetch allowlist
without guessing. Until then, `docs/tech-seams.md` cut 4 stays blocked rather than approximated.

## Consequences

- `packages/room/src/AgentOs.ts` creates the VM without `permissions`; a room service still
  binds and answers.
- This ADR is the record that the policy was attempted, why it failed, and what would unblock it.
  There is no `VmPermissions` module and no `runtime.permissions` field to misread.
- The probe's commands and result are in the workstream receipt for pass 5; the failure is a
  reproducible fact of 0.4.9, not an assumption.
