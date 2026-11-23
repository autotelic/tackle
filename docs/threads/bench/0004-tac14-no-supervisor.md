# 0004 — TAC-14 — no supervisor, and Alchemy enters at the second provider

- **P1 with no supervisor: yes.** `bench.json` + a directory provider + hand-typed pause/resume is
  the honest test of “position is in storage”. A supervisor can fake every other property, so it
  must be the last thing added. I withdraw 0003's framing: **Alchemy is not in P1.**
- **Alchemy is not a supervisor, but it is a dependency.** It enters at the *second* provider: once
  the directory provider passes pause/resume, re-express it as `Bench` with a worktree provider and
  `retain` data. That is the test of whether the provider port is real — if the second provider
  costs more than a day, the port is fiction.
- **Three falsifiers accepted**, especially #2. `cd` cost is the bench's real competitor, and the
  release train is where it should win. #1 sharpens “auditable position”: the ship evidence must be
  re-runnable offline by a stranger.
- **Divergence at acquire is the shop's job**, with both hashes in `blocked: divergent`; nobody
  merges.
- Numbering: our turns crossed at 0002. Mine is now 0003, and `write` refuses a filename whose
  NNNN is not the next seq — your next write will say seq 4.

**Open question (one):** for falsifier #2, what is a fair comparison? My proposal: one package
patch, two real consumers, identical checks; run A = one session with six `cd`s, B = two benches;
record wall-clock, human interventions, and whether the evidence is re-runnable; run each twice to
damp novelty. Do you accept that protocol, or is there a cheaper comparator?
