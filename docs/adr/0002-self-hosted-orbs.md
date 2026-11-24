# ADR 0002 — borrow the orb provider pattern, not the hosted control plane

Status: research accepted  
Date: 2026-11-24

## What Amp does

Amp's Orbs are isolated environments for agent threads. The useful shape is _self-hosted
orbs_:

- a local **provider** process runs inside the operator's network and connects out to Amp;
- Amp sends `spawn`, `pause`, and `delete` jobs;
- the operator's dispatch program creates, resumes, stops, or removes a machine/container;
- on spawn it starts `amp orb bootstrap` with an `ORB_TOKEN`; Amp never connects inward;
- pause keeps the disk (and, for Amp-hosted orbs, memory); resume continues the same orb;
- an archived orb is paused, not deleted; delete is a separate event;
- a **portal** is the service surface; not every compute provider preserves memory, so the
  experience differs by substrate.

The important separation is:

```text
control plane         provider (your network)          orb (isolated machine)
Amp / board    ──outbound──▶ dispatch.sh       ──spawn──▶ amp orb bootstrap
                              │                              │
                              └── pause / delete ────────────┘
```

## What transfers to Tackle

```text
Amp orb concept             Tackle
─────────────────           ─────────────────────────────────────────────
thread / orb                workstream / room
spawn                       create room, start supervisor
pause                       pause room, keep disk and process state if the provider can
delete                      retire / room down / archive
dispatch provider           RoomProvider + board daemon
portal                      preview route
ORB_TOKEN                   room/provider lease, never a host secret
project snapshot            checkpoint / worktree snapshot
.agents/setup + resume      setup pass + resume pass
```

The current agentOS Core dependency is the **embedded** form of this pattern: the sidecar
runs in-process, each room gets its own filesystem and processes, and there is no hosted
credential. That is the self-hosted answer; the hosted agentOS actor is not required.

## What not to copy

- Do not make Amp or any hosted control plane the owner of the room. The board owns the
  room record; a provider is replaceable.
- Do not require inbound connectivity. A provider may be a local process or a remote
  dispatcher, but the control direction must be outbound or loopback.
- Do not equate archive with delete. An archived room keeps its disk and evidence.
- Do not claim memory preservation on a substrate that cannot do it. State the provider's
  capability instead of silently degrading.
- Do not put a credential in the room record. Pass a short-lived lease/token through the
  provider environment.

## Next concrete slice

1. Add `pause` / `resume` / `delete` to the room provider contract, with the current
   local provider and the embedded agentOS provider.
2. Make the agentOS room's `network.preview` reachable through the board preview route,
   instead of forwarding only a host port.
3. Record a provider capability matrix (`memory`, `disk`, `snapshot`, `preview`) so the
   UI can say what survives a pause.

## References

- https://ampcode.com/docs/orbs
- https://ampcode.com/docs/orbs/self-hosted
- https://github.com/rivet-dev/agentos
- https://github.com/rivet-dev/agentos (embedded Core: `@rivet-dev/agentos-core`)
