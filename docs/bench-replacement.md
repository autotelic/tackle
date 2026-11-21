# Replacing room and board with bench and shop

Status: **bought in by TAC-15 with three vetoes (bench 0013); the operator overrode V2 and approved
bumping Effect to the latest across the workspace.** No destructive commit starts until the
pre-flight protocol in “Roles” is followed.

## Goal

Room and board are removed; bench and shop are built fresh, on `main`, in commits that each leave
`main` green. Nothing is salvaged from room or board — not modules, not tests. The design docs
(`shop.md`, `bench-steelman.md`, `bench-alchemy.md`, `otp-and-at.md`) are the spec.

**Table stakes, not later phases:** Alchemy provisions (`retain` data, `destroy` runtime, adoption
refuses a stale generation); Alchemy Domain + Layers model the control plane (one aggregate per
bench/message/lease/pin, one writer, stories in memory, DO hosting as a Layer swap); AT federation is
wire-compliant (his procedures, error names, fixtures, HPKE, `did:key`/`did:web`, real at-uris/CIDs),
proven by a message and a record crossing between our host and a Rat King instance.

## Vetoes

**V1 — no live entry point without its package.** `jig room` is a passthrough in
`packages/jig-cli/src/cli.ts` and an init branch in `init.ts`; it is not a tombstone. **C1 removes
the passthrough, the init branch and the generated docs, and deletes room/board in the same commit.**
A `jig room` that crashes is worse than one that does not exist.

**V2 — originally “do not bump the shipped tools”; overridden by the operator.** Effect goes to
**4.1.5** (the latest; `@alchemy.run/domain` peers on `^4.1.4`) for **every package**, in one
isolated commit, C2. The isolation is the constraint that survives: C2 changes dependency versions
and nothing else; any API change a package forces is its own commit.

**V3 — acceptance is by refusal, not by plumbing.** Each milestone's acceptance test is a refusal
first:

- C5 (move): a stale writer is refused with both hashes, and **nothing is deleted**.
- C6 (mailbox): `LeaseMismatch`, `Conflict`, `Retired`, `RoleUnresolved` each produce _his_ error
  name from _his_ fixture.
- Falsifiable for every milestone: **delete the happy-path test and the milestone is still green.**

Refusal tests take direct inputs and do not reuse a happy-path helper.

## Reference implementation

`alchemy-run/alchemy` PR **#3506** (open, pinned head `02e682f`), example
`cloudflare-domain-board`: a Domain model on Cloudflare DOs serving a foldkit web app, an MCP
server and a CLI derived from one `Api`.

**`toCli` rule:** generate the wiring, hand-write the semantics. Verbs, flags, exit codes and
`--json` shapes are ours; `toCli` generates the plumbing so they cannot drift. MCP is read-only first,
and its output must be **byte-identical** to the CLI's `--json`; no MCP write path until it can carry
`{ leaseId, generation }`.

Borrow: the `Thread` aggregate's claim/renew/complete/release shape; `Leases` scheduling
`ExpireLease` with a deterministic command id, a renewal replacing the deadline, and the expiry
recording nothing if completed in time; typed rejections with `httpApiStatus`; the
domain/server/cli/web layout and the story/server/integration test split; `toCli` and `toMcp`.

Do not borrow: its lease is local to one DO (no cross-host fence or generation handover); its shared
token + actor header is not per-channel authorization; `Thread` is `work.item`/desk, not the bench
container; `toMcp` must not become a second implementation of a surface.

## Principles

1. Every commit is format → typecheck → test → `mailbox verify` → build → push. If it cannot be
   green, it is split.
2. One owner per thing: a claim, a lease, a port, a worktree, a journal. Never two processes.
3. A package disappears in the same commit as its last caller, and its CLI entry point dies in that
   commit.
4. No PRs. Trunk commits on `main`.
5. The model comes before the host: if a move cannot pass as an in-memory story with stubbed
   external systems, hosting it on a DO only makes the bug distributed.
6. Acceptance by refusal.

## Target layout

```
packages/
  protocol/         AT wire lexicons + records (no runtime)
  bench-domain/     pure: Bench, Message, Lease, Pin, DeskItem, sagas, policies, stories
  bench-server/     hosting (DO), providers, Alchemy stack, bench + shop bins
  mailbox-domain/   mailbox/lease bounded context
  mailbox-server/   XRPC Api + HPKE + fixtures
  jig-cli/          check · baseline · pin · ship · verify
  plumb/ joggle/ cutlist/ treadle/
  — room/ board/ deleted —
```

All packages on Effect 4.1.5 after C2. `bench-domain` and `mailbox-domain` import only
`@alchemy.run/domain` and `effect`; the server packages own Docker, GitHub, the filesystem, HPKE and
DO hosting.

## Commits

| #   | Commit                                                                                                                                                                                                                                                                                                                                                                          | Verification                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| C0  | this plan + the buy-in turn                                                                                                                                                                                                                                                                                                                                                     | `pnpm check`, thread verify                                                                                                            |
| C1  | **`remove room and board`** — packages; `jig room` passthrough + `src/room.ts` + init branch/docs/table/tests; `skills/room` + project-run; `tsconfig.base.json` board path; `.jig-baseline.json` (prune by hand); `jig.config.json`; `oxlint.config.ts` + root `package.json` lint; `joggle.config.json`; `jig-cli/README`; `PUBLISHING`/`README`/`ONBOARD`; `docs/room*.html` | grep proof; no stale baseline identities; `jig init` no room; `jig room` unknown, not a crash                                          |
| C2  | **`effect 4.1.5` across the workspace** — catalog pins only, no feature changes                                                                                                                                                                                                                                                                                                 | `pnpm -r why effect` shows 4.1.5 everywhere; `pnpm check` green; `jig check` on `examples/self`; `git show --name-only --format= <sha> | grep -E 'protocol/schema | /bin/ | config\.json |
| C3  | **`bench-domain` + `bench-server`** — Bench aggregate, Create/Pause/Resume, worktree provider, `Domain.InMemory` stories                                                                                                                                                                                                                                                        | stories pass; `alchemy plan` works                                                                                                     |
| C4  | **host on DOs + `shop`** — `DomainCloudflare.layerDurableObjects()`, child specs, intensity                                                                                                                                                                                                                                                                                     | kill a child → restart; crash loop → desk                                                                                              |
| C5  | **move saga** — quiesce/release/seal/copy/acquire/countersign/archive; adoption                                                                                                                                                                                                                                                                                                 | **refusal:** stale writer has both hashes, nothing deleted                                                                             |
| C6  | **`mailbox-domain` + `mailbox-server`** — his procedures, error names, fixtures                                                                                                                                                                                                                                                                                                 | **refusal:** four error names from his fixtures                                                                                        |
| C7  | **HPKE + DIDs** — sign-then-encrypt, `did:key`, `did:web`                                                                                                                                                                                                                                                                                                                       | foreign DID verifies; plaintext send rejected                                                                                          |
| C8  | **records + federation** — real at-uris/CIDs; cross-host message + record                                                                                                                                                                                                                                                                                                       | resolvable from another host                                                                                                           |
| C9  | `jig: pin + ship`                                                                                                                                                                                                                                                                                                                                                               | pin/lockfile drift fails                                                                                                               |
| C10 | cleanup + npm deprecate                                                                                                                                                                                                                                                                                                                                                         | check green; deprecation reported                                                                                                      |

## C1 blast radius (confirmed by TAC-15)

1. `packages/room` and `packages/board` — delete.
2. `packages/jig-cli/src/cli.ts` — the `isRoomInvocation`/`runRoom` passthrough and the description.
3. `packages/jig-cli/src/room.ts` — delete.
4. `packages/jig-cli/src/init.ts` — the `"room"` fact, detection, `roomSection`, table row, onboarding text, skills list.
5. `packages/jig-cli/src/init.test.ts` — room cases.
6. `packages/jig-cli/skills/room` — delete; `skills/project-run` references.
7. `packages/jig-cli/README.md` — the room line.
8. `tsconfig.base.json` — the `@autotelic/board` path mapping.
9. `.jig-baseline.json` — **11 identities naming room/board files; prune by hand**, diffing only deletions. No `jig baseline --prune` feature in a deletion commit.
10. `jig.config.json` — the `packages/room/extensions/**` ignore.
11. `oxlint.config.ts` + root `package.json` lint args — every explicit `packages/room` list.
12. `joggle.config.json` — the room exception; `PUBLISHING.md`, `README.md`, `ONBOARD.md`; `docs/room*.html`.

**Rollback:** `git revert <C1 sha>`; C1 touches no published artifact and no wire record.
**Proof after:** `grep -rn 'packages/room|packages/board|@autotelic/room|@autotelic/board|jig room'` outside CHANGELOGs/journal/threads returns nothing; `pnpm check`; `jig check` shows no stale baseline identity.

## Acceptance tests

**Alchemy:** plan shows create/update/replace/delete; data children are `retain` and a stack
`destroy` keeps the journal; host change replaces the runtime only; stale generation is refused;
Docker services restart under `drift --repair`.

**Domain:** the move and lease stories run in memory with the copy and GitHub stubbed; every
rejection is exercised; `Verify` invariants hold (one writer, generation monotonicity, no journal
delete). Happy paths may be deleted without removing a refusal.

**AT:** every `v0` fixture, every error name; same `(senderDid, TID)` returns the original receipt,
different bytes is `Conflict`; `ack` needs `recipientDid`+`leaseId`+`generation`; lease ≤ 5
minutes, handover at gen+1; HPKE envelope; a record resolves by URI/CID from another host.

## Roles and the honesty loop

- **TAC-14 builds.** **TAC-15 reviews and owns the lexicons, records and the AT fixture gate.**
- **Before C1/C2/C10:** intent + blast radius + grep proof + rollback; wait for ack or a blocker.
- **After every commit:** SHA, what changed, the command and exit code, one falsifiable claim.
  The peer tries to break the claim, not to approve the code.
- **Peer checklist:** second owner? seam broken? can the test fail? deleted reference? claim
  verified by a command? AT contract intact?
- **Peer re-runs** at least `pnpm check` and `pnpm mailbox:verify` independently.
- Decisions go into the threads; intercom only points at them with one open question.

## Risks / unknowns

- **One big bump:** Effect 4.1.5 may change APIs in jig/joggle/cutlist/mailbox. C2 is dependency-only;
  every forced API change is its own commit, and C2 can be reverted alone.
- **Beta on beta:** Alchemy and Domain are `2.0.0-beta.87`; pin exact.
- **HPKE interop:** his fixtures are opaque example data, not crypto vectors. C7 needs vectors or a
  live partner.
- **PDS and `did:web`:** C8 needs a real repo host and DNS; `autotelic.dev` is the intended face.
- **Two logs:** Domain's event log is control-plane truth; pi-durable is the conversation. Never
  merge them.
- **Saga ≠ transaction:** a move coordinates; the copy is an external effect; compensation is
  archive/quarantine, never rollback.
- **Public Api ≠ model:** XRPC schemas map onto commands; no wire-shaped fields in the aggregate.

## Resolved

- Delete-first: yes; C1 does packages and entry points together.
- Effect: **4.1.5 across the workspace at C2**, isolated, per the operator.
- `domain`/`server` split: yes, for both bench and mailbox.
- C7 partner: **local Rat King checkout, pinned SHA**, with the hosted service as a non-gating smoke
  test; a hosted instance can change under a claim.
  ` is empty |
  | C3  | **`bench-domain`+`bench-server`** — Bench aggregate, Create/Pause/Resume, worktree provider, `Domain.InMemory`stories                                             | stories pass;`alchemy plan`works                                                              |
  | C4  | **host on DOs +`shop`** — `DomainCloudflare.layerDurableObjects()`, child specs, intensity                                                                          | kill a child → restart; crash loop → desk                                                       |
  | C5  | **move saga** — quiesce/release/seal/copy/acquire/countersign/archive; adoption                                                                                      | **refusal:** stale writer has both hashes, nothing deleted                                      |
  | C6  | **`mailbox-domain`+`mailbox-server`** — his procedures, error names, fixtures                                                                                      | **refusal:** four error names from his fixtures                                                 |
  | C7  | **HPKE + DIDs** — sign-then-encrypt, `did:key`, `did:web`                                                                                                           | foreign DID verifies; plaintext send rejected                                                   |
  | C8  | **records + federation** — real at-uris/CIDs; cross-host message + record                                                                                            | resolvable from another host                                                                    |
  | C9  |`jig: pin + ship` | pin/lockfile drift fails |
  | C10 | cleanup + npm deprecate | check green; deprecation reported |

## Acceptance tests

**Alchemy:** plan shows create/update/replace/delete; data children are `retain` and a stack
`destroy` keeps the journal; host change replaces the runtime only; stale generation is refused;
Docker services restart under `drift --repair`.

**Domain:** the move and lease stories run in memory with the copy and GitHub stubbed; every
rejection is exercised; `Verify` invariants hold (one writer, generation monotonicity, no journal
delete). Happy paths may be deleted without removing a refusal.

**AT:** every `v0` fixture, every error name; same `(senderDid, TID)` returns the original receipt,
different bytes is `Conflict`; `ack` needs `recipientDid`+`leaseId`+`generation`; lease ≤ 5
minutes, handover at gen+1; HPKE envelope; a record resolves by URI/CID from another host.

## Roles and the honesty loop

- **TAC-14 builds.** **TAC-15 reviews and owns the lexicons, records and the AT fixture gate.**
- **Before C1/C2/C10:** intent + blast radius + grep proof + rollback; wait for ack or a blocker.
- **After every commit:** SHA, what changed, the command and exit code, one falsifiable claim.
  The peer tries to break the claim, not to approve the code.
- **Peer checklist:** second owner? seam broken? can the test fail? deleted reference? claim
  verified by a command? AT contract intact?
- **Peer re-runs** at least `pnpm check` and `pnpm mailbox:verify` independently.
- Decisions go into the threads; intercom only points at them with one open question.

## Risks / unknowns

- **One big bump:** Effect 4.1.5 may change APIs in jig/joggle/cutlist/mailbox. C2 is dependency-only;
  every forced API change is its own commit, and C2 can be reverted alone.
- **Beta on beta:** Alchemy and Domain are `2.0.0-beta.87`; pin exact.
- **HPKE interop:** his fixtures are opaque example data, not crypto vectors. C7 needs vectors or a
  live partner.
- **PDS and `did:web`:** C8 needs a real repo host and DNS; `autotelic.dev` is the intended face.
- **Two logs:** Domain's event log is control-plane truth; pi-durable is the conversation. Never
  merge them.
- **Saga ≠ transaction:** a move coordinates; the copy is an external effect; compensation is
  archive/quarantine, never rollback.
- **Public Api ≠ model:** XRPC schemas map onto commands; no wire-shaped fields in the aggregate.

## Resolved

- Delete-first: yes; C1 does packages and entry points together.
- Effect: **4.1.5 across the workspace at C2**, isolated, per the operator.
- `domain`/`server` split: yes, for both bench and mailbox.
- C7 partner: **local Rat King checkout, pinned SHA**, with the hosted service as a non-gating smoke
  test; a hosted instance can change under a claim.
