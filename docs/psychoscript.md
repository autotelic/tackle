# Psychoscript: research note

Evaluated at `anomalyco/psychoscript` on 2026-11-25 (`dev`; latest release v0.3.0; MIT; 36 stars).

## What it is

A confined, resumable JavaScript interpreter. Programs compile to bytecode and run on a VM with no ambient
filesystem, network, process, timer, `eval`, or prototype mutation. Every effect crosses through a **host
function** the host supplies. A run can be suspended to bytes and resumed in another process, provided the
build and host-global shape match.

The repo is deliberately only the language: compiler, VM, scheduler, standard library, snapshots, Promise API,
and an optional `psychoscript/effect` adapter. There is no tool-specific code.

Tech shape:

- Acorn parser, own bytecode VM, own Promise/scheduler implementation
- Host functions: sync, async, durable (`start` / `wait` / `cancel`), lazy namespaces
- Snapshot header binds the build hash, host-global hash, sources/bytecode hashes, limits, and run metadata
- Limits: active-time timeout, output cap, string/array/promise/BigInt caps, call-depth limit
- Test262 suite with an explicit support matrix and skipped-gap report
- Root API is Promise-based; Effect is optional (`effect ^4.1.0`), matching our workspace's 4.1.5

## What it is not

- not a VM, container, or OS: no filesystem/process/network; a host function can expose any of those
- not a process supervisor, lease authority, durable queue, or identity system
- not a replacement for a coding-agent harness: it cannot run a pass that needs git, a shell, or a worktree
- not durable across generations: the snapshot is explicitly tied to the build and host-global shape; a new
  opcode/prelude/host invalidates it
- not a policy or credential broker: the host function is the capability, and the host must scope it

## Where it fits

```text
Agent OS / room
  capability manifest + lease
       │
       ▼
Executor / tool catalog + credentials
       │  resolves capabilities to host functions
       ▼
psychoscript runtime
  confined program; no ambient I/O
       │  Host.fn / Host.durableFn
       ▼
board · jig · room · mailbox · app APIs
```

**Best home: the codemode/tool-execution layer.** It is the strongest candidate we have seen for “run a
model-generated program against a controlled API” without handing it a shell. The host-function boundary is
exactly the capability boundary; `Host.namespace` matches lazy tool catalogs; `Host.durableFn` matches
long-running MCP work; `StreamingResponse` matches a streaming tool result.

It is a plausible **Executor codemode runner**: Executor owns catalog/credentials/policy; psychoscript owns the
confined evaluation. It does not make Executor the authority for our room or lease.

It is not a factory-pass runner. A pass needs `git`, `pnpm`, a worktree, and a terminal. It could be used inside
a pass for a small deterministic transformation, but that is not the main prize.

It is not the bench/container provider. A container gives a real filesystem/process boundary; psychoscript
confines code inside a host process, with host functions deciding every effect.

## Risks

- **Young**: v0.3.0, one maintainer/org, 36 stars. The test262 discipline is strong, but it is not yet a
  dependency with a long support history.
- **Build-bound snapshots**: resumption is same-build only. For our generation model, a snapshot must carry the
  generation it belongs to and be resumed only by that generation; don't pretend it survives an upgrade.
- **Host is the security boundary**: a host function that reads any file or shells out defeats the confinement.
  The capability manifest and Executor policy still have to scope the host functions.
- **Bun dev loop**: this repo targets Bun >= 1.4; our local Bun is 1.3.14 and cannot parse its lockfile. That is a
  test-environment mismatch, not a runtime defect, but it affects the trial.
- **No host-circuit breaker**: the host decides timeouts/limits at the runtime; a host function can still hang
  unless it honors `call.signal`.

## Recommendation

**Prototype it, do not adopt it wholesale.** Build one narrow adapter behind a `CapabilityRuntime` seam:

1. Expose read-only `board_fleet`, `jig_check --json`, and `room_status` as host functions.
2. Run a model-generated program that composes them; prove no shell, no filesystem, no network is reachable.
3. Snapshot a durable host call, restart the process, resume it, and prove a generation mismatch is rejected
   with a typed error.
4. Compare against Pi Fabric codemode and Executor's QuickJS runtime on cold start, memory, snapshot size, and
   the number of host functions required.
5. Keep the capability manifest above it. Psychoscript confines code; it does not decide which capabilities a
   room is allowed to have.

**Verdict:** yes, it has a home — the confined codemode runtime under the room/Executor capability seam. No,
it is not the factory kernel, not the room, and not the bench container.
