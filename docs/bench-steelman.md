# Bench, steelmanned

## The strongest case

The unit of agent work is not a chat, a PR, or a repo. It is **a scope with a durable place**. Today
an agent's state lives in a process and its context lives in a transcript, so everything expensive is
re-derived on every attempt: clone, install, discover how to run the checks, re-read the issue,
re-explain the constraint. A bench moves the expensive things — worktree, kit, services, credentials,
journal, mail — into storage and gives them a name. The marginal cost of the next task in an existing
scope collapses, and handoff (human→agent, machine→machine, agent→agent) becomes a protocol instead
of a retelling.

Three arguments make it more than a nicer worktree:

1. **Position is in storage, not the process.** pi-durable commits turns before showing them,
   checkpoints tasks, keys submissions, stores sleeps with deadlines. So
   `storage + worktree + outbox + desk + bench.json` _is_ the bench. Move, backup, pause, and restore
   are the same six steps. Portability becomes a format, not a migration project.
2. **The fence is the safety property.** "Two agents, one branch" is the failure mode of multi-agent
   work. A lease with a generation, held outside the process, makes a stale writer unable to _effect_
   anything. The fence cannot stop two copies of the _data_ existing — hence quarantine, never merge.
3. **Checks are declared, so "done" is reproducible by a stranger.** `bench.json` names
   `jig check`/`pnpm test`; the run ends in one PR with evidence. Bench is the only host where the
   repo's own conformance tools are the gate.

The commercial insight is right: **the binding constraint is attention, not CPU.** Twelve paused
benches cost disk; twelve active ones cost twelve PRs to read. A queue of scopes ordered by what pays
for them is the product. That is why `bench queue` matters more than `bench new`, and why the
portfolio layer (org → repo-set → bench) is coherent rather than scope creep.

The killer app is the release train: one package version, N consumers, each verified by its own
tooling, adoption computed from derived pins, the parent never editing a child.

## What does not work, or will not yet

- **The critical path is eight subsystems, not one idea.** A bench needs a mailbox host, a lease
  service, a supervisor, a storage layout, a provider abstraction, a desk, an outbox flush, and a pin
  format. The design is coherent; the risk is that every layer is "almost done" and the first real
  bench never runs.
- **L0 is honest but feels slow.** Without memory snapshots every wake restarts services; ten seconds
  for `.agents/resume` is hard for node + db + compose. Users judge a place by how fast it comes back.
- **The org layer is a second product with a second buyer.** Repo-sets, an always-on org bench, a VPS,
  DNS, certs, backups: an availability commitment unrelated to the core insight. Building it before
  one bench loop is proven is how this becomes infrastructure theater.
- **The fence protects effects, not data.** The hard case is one stale journal after a restore, or two
  worktrees from the same base. The continuation token detects divergence only if someone compares
  `journal.sha` before entry. Who, and what does the human see when it fails?
- **Mail has no deployed counterpart.** The at-seam thread proved the format; it did not prove a
  service. Until two benches exchange one mail without a human, "addressable" is a design claim.
- **The release train assumes consumers are benches.** Real consumers are repos with CI and human
  reviewers. And a repo that emits no pin is indistinguishable from one that is behind — without a
  "missing" state, adoption numbers lie.
- **WIP is untested and probably optimistic.** Twelve active benches is twelve context switches for
  the human. The metric that matters is ready→reviewed latency, not benches running.
- **Secrets and portability are in tension.** Re-injection is correct, but a moved bench also needs
  the same endpoints and tool availability; the token has no field for environment compatibility.
- **The supervisor is a distributed system with one node.** If it dies, every bench is ownerless; on
  restart it must reconcile leases and children. That is the hardest code in the system and the doc
  gives it a paragraph.

## What exists already (integration, not invention)

| piece                                    | state                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| loop engine                              | `treadle`: one session at a time, receipts, checkpoints, rules          |
| claim / fence / review / durable session | `room` + `board`: chit states, epoch, marker, pi-durable session        |
| store-side seam                          | `mailbox`: canonical log, deterministic projection, verify, write       |
| checks                                   | `jig`, `joggle`, `plumb`, `cutlist`                                     |
| **host**                                 | **nothing**: no supervisor, no storage layout, no move, no `bench.json` |

## Prototypes, cheapest falsifier first

**P0 — Mailbox, two authors, one restart (1 day).** `mailbox serve`: SQLite, SQLite-backed
`send`/`list(afterSeq)`/`deliver`/`ack`/`lease` over his XRPC paths. Move the at-seam thread onto
it; two sessions, one on another machine.
_Kill:_ any lost or duplicated turn after restart; a watermark that replays or skips.

**P1 — Move one bench (2 days).** A bench is a pi-durable journal + git worktree + `bench.json` +
outbox + lease. `bench move` between two directories, then two machines: seal, copy, verify hashes,
release, acquire at gen+1, restore-before-entry.
_Kill:_ hash mismatch, a copied lease, a lost turn, or a wake that breaks the 10s resume.
**Measure wake time on tackle itself** — that is the felt product. This is the most falsifiable claim:
_position is in storage_.

**P2 — Two benches, one repo, one lease (1 day).** Both attempt to write; the stale one is rejected;
kill the holder and take over at gen+1; verify no duplicate review or comment. Reuses board's
acquire/nextEpoch/conflicts and room's marker.
_Kill:_ any double effect, or a takeover that loses a queued task.

**P3 — Release train, two real consumers (2–3 days).** Ship a patch of a real shared package; two
benches bump, run their own checks, emit a derived `repo.pin`; compute adoption from the pins.
_Kill:_ the parent has to edit child code; adoption cannot be computed offline; pin disagrees with the
lockfile.

**P4 — Human factors, not code (a week of calendar time).** Run 3 benches, then 12. Record
ready→reviewed latency, context switches, and how often you ask "what is blocked and why".
_Kill:_ if the queue does not reduce the human's tour of repos, the portfolio thesis is wrong no
matter how good the code is.

**P5 — Backup/restore (half day, piggybacks on P1).** `bench move` to cold storage and back.
_Kill:_ restored bench diverges or cannot re-acquire.

## What I would not build yet

The org bench as a running service, L2/L3 providers, the desk UI, the TUI, AT federation beyond the
mailbox, and the supervisor's full recovery logic. Each multiplies a claim P0–P2 have not validated.

## Sequencing and the falsifier that matters

P0 is the only hard dependency. P1 and P2 can run in parallel once the lease is a SQL port rather than
an HTTP room. P3 needs P0 plus pin derivation. P4 starts with P1 because it is calendar-bound.

The falsification that matters most: **if a bench wakes in 30 seconds and the human still tours
repos, this is a very good worktree manager — useful, but not the thesis.** P1 and P4 settle that, and
they are cheap.
