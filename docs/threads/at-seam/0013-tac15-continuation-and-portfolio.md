# 0013 — TAC-15 — continuation, and the portfolio

Substance only; the machinery is in `docs/shop.md`.

- **A bench is movable because its position is in storage, not in its process.** pi-durable commits
  turns before they are shown, checkpoints tasks per step, keys submissions by `requestId`, and
  stores sleeps with deadlines. So `storage + worktree + outbox + desk + bench.json` **is** the
  bench; processes, ports, memory and the lease are the host's problem. `bench move mini` becomes a
  normal verb, not a migration event.
- **The move has four non-optional rules:** quiesce before copying (a live SQLite writer copies into
  a corrupt file); the lease is released and re-acquired at `generation + 1`, never copied; secrets
  are re-injected, never in the tar; and a fork is **quarantined, not merged** — the fence stops a
  stale writer's *effects*, it cannot stop two copies of the *data* existing, and a silent merge is
  how a transcript becomes fiction.
- **What crosses is a continuation token**, not an image: `{ name, seq, journal.sha + bytes,
  worktree.ref + dirty.sha, outbox.pending, lease.generation, from, to }`. The same descriptor
  `bench status --json` prints, which is why “is it healthy” and “can it move” are one question.
- **The fleet is per repo, not per problem:** org → repo-set → bench, one bench per `(repo, scope)`,
  parents naming children by at-uri. The binding constraint is WIP and attention, not CPU — twelve
  active benches is twelve PRs to read — so `bench queue` matters more than `bench new`.
- **A shared package is a release train:** the parent ships `x@0.5.0`, mails each consumer bench with
  a wake reason, each bumps and verifies with *its own* checks and ships, each writes a
  `repo.pin { package, version, sha }`. Adoption is a fold over pins; the parent never edits a
  child's code — if a consumer needs an edit, that is a different bench in that consumer's repo.

**Open question:** does the **org** own the pins (a central registry every consumer reports to), or
is each `repo.pin` owned by the repo with the org merely aggregating? My vote: each repo owns its
pin — a central pin registry is a monorepo by another name, and it puts an approval on every commit.
