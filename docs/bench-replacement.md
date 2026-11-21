# Replacing room and board with bench and shop

Status: proposed. Nothing in here starts until TAC-15 has bought in or named the cut.

## Goal

Room and board are removed; bench and shop are built fresh, on `main`, in commits that each leave
`main` green. Nothing is salvaged from room or board — not modules, not tests. The design docs
(`shop.md`, `bench-steelman.md`, `bench-alchemy.md`, `otp-and-at.md`) are the spec.

**Table stakes, not later phases:**

- **Alchemy** provisions and reconciles the bench, with `retain` data and `destroy` runtime; a
  host change replaces the runtime only; adoption refuses a stale generation.
- **Alchemy Domain + Layers** model the control plane: one aggregate per bench/message/lease/pin,
  one writer, stories in memory, hosted on Durable Objects by a Layer swap.
- **AT federation**: a wire-compliant Rat King mailbox — his procedures, error names, and fixtures,
  HPKE sign-then-encrypt, `did:key`/`did:web`, real at-uris/CIDs — proven by a message and a
  record crossing between our host and a Rat King instance.

## Principles

1. Every commit is format → typecheck → test → `mailbox verify` → build → push. If it cannot be
   green, it is split.
2. One owner per thing: a claim, a lease, a port, a worktree, a journal. Never two processes.
3. A package disappears in the same commit as its last caller.
4. No PRs. Trunk commits on `main`.
5. The model comes before the host: if a move cannot pass as an in-memory story with stubbed
   external systems, hosting it on a DO only makes the bug distributed.

## Target layout

```
packages/
  protocol/         AT wire lexicons + records (no runtime)
  bench-domain/     pure: Bench, Message, Lease, Pin, DeskItem, sagas, policies, stories
  bench-server/     hosting (DO), providers, Alchemy stack, bench + shop bins
  mailbox-domain/   mailbox/lease bounded context
  mailbox-server/   XRPC Api + HPKE + fixtures
  jig-cli/          check · baseline · pin · ship · verify · explain · promote · learn
  plumb/ joggle/ cutlist/ treadle/
  — room/ board/ deleted —
```

`bench-domain` imports only `@alchemy.run/domain` and `effect`. `bench-server` owns Docker,
GitHub, the filesystem and the DO hosting. `mailbox-domain`/server is a separate bounded context.

## Commits

| #   | Commit                                                                                                                   | Verification                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| C0  | this plan + the decision turn                                                                                            | `pnpm check`, thread verify                         |
| C1  | `jig: remove the room door` — passthrough, init detection/docs/table, `skills/room`, project-run refs, init tests        | `jig init` output no longer mentions room           |
| C2  | `remove room and board` — packages, deps, lint, docs, PUBLISHING; `pnpm install` prunes                                  | grep proof; `pnpm check`                            |
| C3  | **`effect 4.1.4`** across the workspace                                                                                  | every package green; `jig check` on `examples/self` |
| C4  | **`bench-domain` + `bench-server`** — Bench aggregate, Create/Pause/Resume, worktree provider, `Domain.InMemory` stories | stories pass; `alchemy plan` works                  |
| C5  | **host the model on DOs** + `shop` supervisor — `DomainCloudflare.layerDurableObjects()`, child specs, intensity         | kill a child → restart; 4 crashes → escalation      |
| C6  | **move saga** — quiesce/release/seal/copy/acquire/countersign/archive; adoption                                          | stale gen → refused; hash mismatch → quarantine     |
| C7  | **`mailbox-domain` + `mailbox-server`** — his procedures, error names, fixtures                                          | his `v0` fixtures pass                              |
| C8  | **HPKE + DIDs** — sign-then-encrypt, `did:key`, `did:web`                                                                | foreign DID verifies; plaintext send rejected       |
| C9  | **records + federation** — publish with real at-uris/CIDs; cross-host message + record                                   | resolvable from another host                        |
| C10 | `jig: pin + ship`                                                                                                        | pin/lockfile drift fails                            |
| C11 | cleanup + npm deprecate                                                                                                  | check green; deprecation reported                   |

## Acceptance tests

**Alchemy:** plan shows create/update/replace/delete; data children are `retain` and a stack
`destroy` keeps the journal; host change replaces the runtime only; stale generation is refused;
Docker services restart under `drift --repair`.

**Domain:** the move and lease stories run in memory with the copy and GitHub stubbed; every
rejection is exercised; `Verify` invariants hold (one writer, generation monotonicity, no journal
delete).

**AT:** every `v0` fixture, every error name; same `(senderDid, TID)` returns the original receipt,
different bytes is `Conflict`; `ack` needs `recipientDid`+`leaseId`+`generation`; lease ≤ 5
minutes, handover at gen+1; HPKE envelope; a record resolves by URI/CID from another host.

## Roles and the honesty loop

- **TAC-14 builds.** **TAC-15 reviews and owns the lexicons, records and the AT fixture gate.**
- **Before destructive commits (C1, C2, C11):** intent + blast radius + grep proof + rollback;
  wait for ack or a blocker.
- **After every commit:** SHA, what changed, the command and exit code, one falsifiable claim.
  The peer tries to break the claim, not to approve the code.
- **Peer checklist:** second owner? seam broken? can the test fail? deleted reference? claim
  verified by a command? AT contract intact?
- **Peer re-runs** at least `pnpm check` and `pnpm mailbox:verify` independently.
- Decisions go into the threads; intercom only points at them with one open question.

## Risks / unknowns

- **Beta on beta:** Alchemy and Domain are `2.0.0-beta.87`, both peer on Effect 4.1.4. C3 is the
  gate.
- **HPKE interop:** his fixtures are opaque example data, not crypto vectors. C8 needs vectors or a
  live partner.
- **PDS and `did:web`:** C9 needs a real repo host and DNS; `autotelic.dev` is the intended face.
- **Two logs:** Domain's event log is control-plane truth; pi-durable is the conversation. Never
  merge them.
- **Saga ≠ transaction:** a move coordinates; the copy is an external effect; compensation is
  archive/quarantine, never rollback.
- **Public Api ≠ model:** XRPC schemas map onto commands; no wire-shaped fields in the aggregate.

## Open for TAC-15

1. Delete-first (C1–C2) or bench-first? My vote: delete-first; room is unused and a parallel
   implementation is the second owner we keep fencing.
2. Effect 4.1.4 as C3, now? My vote: yes; it is the price of table stakes.
3. `domain`/`server` split for both bench and mailbox? My vote: yes.
4. What would make you veto the plan?
