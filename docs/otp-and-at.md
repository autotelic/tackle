# Erlang, and staying compliant with Rat King

Two questions that turn out to be one: what does OTP do that a bench should, and what does the
Rat King wire require of us while we build it. The meeting point is: **a bench is a process, its
mailbox is his mailbox, its lease is his lease, and its supervisor is the shop.**

## The primary sources

- Armstrong, _Making reliable distributed systems in the presence of software errors_ (2003), §4.3
  “Error handling philosophy” — “let some other process do the error recovery”, “if you can't do what
  you want to do, die”, “let it crash”, “do not program defensively” — and §5.2 “Supervision
  hierarchies”.
- OTP _Supervisor behaviour_: `one_for_one`, `one_for_all`, `rest_for_one`; start/stop/restart
  specs; restart intensity and period (defaults 1 restart in 5 seconds); shutdown semantics.
- Hewitt, Bishop, Steiger, _A Universal Modular ACTOR Formalism_ (1973); Hoare, _Communicating
  Sequential Processes_ (1978). Erlang chose asynchronous mailboxes over synchronous channels.
- Waldo, Wyant, Wollrath, Kendall, _A Note on Distributed Computing_ (1994): latency, memory access,
  partial failure, concurrency — the four reasons location transparency is a lie.
- Chandra & Toueg, _Unreliable Failure Detectors_ (1996), and FLP (1985): no perfect failure
  detector in an asynchronous system. A lease TTL is a failure detector, not truth.
- Garcia-Molina & Salem, _Sagas_ (1987); Saltzer, Reed, Clark, _End-to-end Arguments_ (1984):
  at-least-once delivery plus idempotent endpoints, because exactly-once is not free.

Rat King's own lexicons are the second primary source:
`lexicons/sh/mschf/ratking/{mailbox,runtime,defs}.json` plus `lexicons/fixtures/v0/*`.

## What Erlang actually does

**Processes are cheap and isolated.** A process has its own heap, shares no memory, and communicates
only by messages. That is the whole trick: a bug in one process cannot corrupt another's state, so
recovery can happen somewhere else. Armstrong's “share nothing” is not a style preference; it is what
makes “let another process fix it” possible.

**Failure is a signal, not a return code.** Links propagate exits; monitors deliver
`{DOWN, Ref, Process, Reason}`. A process can trap exits and turn them into messages. The reason
is data. This is why OTP code has very few `if error then ...` branches: the branch belongs to
whoever supervises.

**Supervisors restart to a known state.** A supervisor has children with start/stop/restart specs,
a strategy (`one_for_one` = only the dead child; `one_for_all` = siblings are terminated and
restarted in order; `rest_for_one` = the dead child and everything started after it), and an
intensity (`max_restarts` in `max_seconds`). Exceed it and the supervisor dies, escalating to its
parent. “Let it crash” is only safe because the restart boundary and the escalation path exist.

**Behaviours are the shape of long-lived processes.** `gen_server` gives `handle_call` (sync),
`handle_cast` (async), `handle_info` (timers, exits, monitors). The programmer writes callbacks;
the behaviour owns the loop, the mailbox, and the error semantics.

**Applications and releases are the packaging.** A system is a tree of applications, each with
dependencies and a start/stop order. Hot code loading swaps a module's version while the process
keeps its identity, with `code_change` migrating state.

**Distribution is explicit and partial.** Nodes connect, monitors detect `noconnection`, and the
runtime reports `machine_died` as if it were a software exit — but Waldo's four differences still
hold. Erlang does not make remote calls look local; it makes remote _processes_ addressable.

## What we should take

1. **A supervision tree, not a daemon loop.** `bench.json` should describe children: the agent
   loop, the services, the outbox flusher, the desk watcher. Each child has a restart type
   (`permanent`/`transient`/`temporary`), a shutdown timeout, and a start order. The shop is the
   supervisor; a bench is a child; services are children of the bench. A crash loop becomes a
   supervision failure on the desk, not an infinite retry with no record.
2. **Exit signals, not polling.** Lease loss should be an exit signal to the bench
   (`{shutdown, lease_lost}`), not a boolean checked every N seconds. A dead service should signal
   its bench. A desk item answered should message the bench. Polling is how a system lies about
   freshness.
3. **Let it crash — with idempotent effects.** Our effects are external: a PR comment, a push, a
   mail send. A restart is only safe if replay is idempotent. We already have the review marker and
   `(senderDid, TID)`; the outbox is the saga. Without that, “let it crash” duplicates work.
4. **Explicit ownership of shared resources.** Erlang's share-nothing is easy because memory is
   private. Our benches share a repo, a filesystem, ports, and a git remote. Make ownership explicit:
   one worktree per bench, one lease per name, one owner per port. Everything else links or monitors.
5. **Bounded mailboxes and backpressure.** Erlang mailboxes are unbounded by default, and that is a
   known footgun. Our outbox and desk need caps, dead-letter queues, and a visible queue length;
   dropping must never be silent.
6. **Restart intensity and exit reasons.** Per bench: max restarts per period, with backoff, and the
   last exit reason in the journal. `bench status` should show restarts, last reason, next retry.
7. **Hot upgrade as a journal migration.** Swapping the agent kit is `code_change`: stop, migrate
   the journal schema, start the new version, keep the name and generation. Never a new bench.
8. **Remote is remote.** A bench on the mini is reached by mail, not by a transparent filesystem
   read. `bench status --remote` is a round-trip with a timeout and a partial-failure answer.
9. **Failure detectors are leases, not truth.** A TTL cannot distinguish a crash from a partition.
   Hence fencing tokens and generations, and no destructive action on suspicion.

## What not to take

- **Selective receive.** Scanning a mailbox for a pattern invites priority inversion and unbounded
  scans. Use tags and separate queues.
- **Global locks.** Erlang's `global` is a cautionary tale. Our per-name lease with a generation is
  a better cross-machine fence than a cluster-wide lock.
- **Location transparency.** Waldo's four differences did not go away; pretending they did is how
  the “network is reliable” fallacies get into an API.
- **Hot code loading for its own sake.** Adopt the state-migration discipline, not the two-version
  runtime.
- **Unbounded mailboxes.**
- **“Let it crash” without idempotency.** External side effects make the naive version a duplicate
  machine.

## The two state machines (do not merge them)

Erlang is precise about this, and our designs keep blurring it:

```
bench lifecycle      starting → ready → working → paused → archived
message lifecycle    accepted → delivered → acked
```

A bench's lease loss is an **exit**, not a message state. A message's ack is not a bench state.
The 13-state chit was the mistake of putting both into one enum. Keep them separate; join them in
`bench status` by rendering two fields, never by merging into one.

## The Rat King wire, exactly

From `sh.mschf.ratking.mailbox.send`:

- Durable admission, **idempotent on authenticated sender DID + TID**. Exact replay returns the
  original admission receipt. Different content under the same id → `Conflict`.
- When the sender holds a live lease, the send **must carry `leaseId` and `generation`**; a stale
  or missing fence → `LeaseMismatch`.
- Errors are the contract: `LeaseMismatch`, `Retired`, `RoleUnresolved`, `InvalidRequest`,
  `AuthRequired`, `Forbidden`, `Conflict`, `UnsupportedEnvelope`, `MailboxUnavailable`.
- `ack`: `accepted → delivered → acked`; requires `recipientDid`, `leaseId`, `generation`; a
  repeat from `acked` returns the original receipt; a bad transition → `InvalidTransition`.
- `lease`: exclusive **per DID**; harness is an open union (pi, claude, codex, opencode, other);
  `expiresAt` is clamped to at most 5 minutes ahead; a signed request with the current
  `leaseId` + `generation` may hand over and fence the old holder, otherwise `LeaseHeld`.
  “Schema validity grants no authority.”
- `receipt`: `{ message: { senderDid, messageId }, recipientDid, state, seq }`; transitions append
  events, never overwrite history.
- `encryptedEnvelope`: sign-then-encrypt HPKE; `{ version, suite, enc, ciphertext, aad }`; the
  application signature is inside the ciphertext, and is **not** an atproto record signature.
- Lexicon evolution: after publication, new fields stay optional; keep identifiers, fields,
  formats, bounds, defaults and encodings; unions stay open; **breaking changes need a new NSID**;
  regenerate schemas and run the fixture check.

## How we stay compliant as we go

1. **Two namespaces, one wire.** `sh.mschf.ratking.*` is the only namespace that talks to a Rat King
   mailbox. `dev.autotelic.*` is ours. Never alias one to the other, and never fabricate a
   `messageRef.uri` for a record we do not have — the lexicon says exactly that.
2. **The adapter is generated, not hand-written.** Run `lexgen` against his lexicons to produce the
   Effect schemas and XRPC layers. A hand-written type is a second contract waiting to drift.
3. **Fixtures are the gate.** His `lexicons/fixtures/v0/*.input/output.json` are the conformance
   suite; run them on every host change, errors included. Our `mailbox verify` becomes one arm of
   that suite, not a substitute.
4. **Envelope before send.** Until HPKE sign-then-encrypt is implemented, our host must not claim
   `send` works. A plaintext local mode is a debug tool, never a compliant path.
5. **The fence is carried, not inferred.** Every send while holding a lease carries `leaseId` and
   `generation`; every ack carries them; handover increments the generation; a stale fence is
   `LeaseMismatch`. The outbox flush is where this lives.
6. **The lease TTL is ≤ 5 minutes.** Renew at half-life; lease loss is an exit signal that
   checkpoints and lets the supervisor decide. Never continue past an expired lease.
7. **Errors verbatim, mapped to policy.** `LeaseMismatch` → re-resolve/re-acquire at gen+1;
   `MailboxUnavailable` → retry the same id; `Conflict` → never retry; `RoleUnresolved` →
   re-resolve the name and re-seal; `UnsupportedEnvelope` → upgrade or fail closed.
8. **Our own lexicons follow his evolution rules.** Optional additions, open unions, new NSIDs for
   breaking changes, and a `lexicon:compat` gate before publishing `work.*`, `finding`,
   `repo.pin`, `package.advisory`, `pin.exception`. Our protocol package already has a
   `lexicon:compat` script; extend it to every published NSID.
9. **Identity is his.** `did:key` for thread #0, `did:web` later, `putDidDocument` when we have a
   public face. No parallel identity system, no custom names in the record.
10. **Procedures first, records later.** Rat King phase 0 is procedure-first with receipts. Do not
    pretend our log is a PDS repo; when we publish records, they need real URIs/CIDs from a PDS.

## Where Erlang and AT meet

A bench is an Erlang process:

```
supervisor (shop)
  └─ bench dev-1575            child spec: permanent, 30s shutdown
       ├─ agent loop           transient (restart only on abnormal exit)
       ├─ services             one_for_one, intensity 3/60
       ├─ outbox flusher       permanent; sends carry leaseId + generation
       └─ desk watcher         monitors human answers
     journal = process state checkpoint
     mailbox = Rat King mailbox (accepted → delivered → acked)
     lease   = Rat King runtime lease (gen g → g+1 on handover)
```

The bench's lifecycle and the message's lifecycle are different state machines. The supervisor sees
exits; the mailbox sees states. `bench status` renders both, side by side.

## Prototypes

- **E0 (half day): exit signals.** Lease loss raises an exit in the bench; kill the poller. Test:
  release the lease mid-run, assert the bench checkpoints and exits with `lease_lost`.
- **E1 (1 day): child specs.** `bench.json` gains `children[]` with restart/shutdown/strategy and
  intensity. Test: kill a service, assert `one_for_one` restart; crash the loop 4 times in 60s,
  assert escalation to the desk.
- **E2 (half day): bounded outbox.** Cap, dead-letter, queue length in status. Test: overflow does
  not drop silently.
- **E3 (1 day): hot upgrade.** Swap the kit, migrate the journal schema, keep the name/generation.
- **AT-A0 (1 day): fixtures.** Run his v0 inputs/outputs against a stub host; every error name
  asserted.
- **AT-A1 (1–2 days): envelope.** HPKE sign-then-encrypt; a plaintext send is rejected in
  compliance mode.
- **AT-A2 (1 day): fence.** Send/ack with stale `leaseId`/generation; assert `LeaseMismatch`; handover
  at gen+1; a receipt at the old generation fails.

The one-line rule: **let the supervisor handle failure, let the endpoint be idempotent, and let the
lexicon own the wire.**
