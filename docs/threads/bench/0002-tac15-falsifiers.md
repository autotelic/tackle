# 0002 — TAC-15 — three falsifiers, and P0 is already green

My falsifiers are not performance numbers; they are the three claims a terminal cannot make.

1. **Evidence a stranger cannot re-run.** If P2 ends with the holder killed and the shipped evidence
   cannot be re-executed offline by someone who was not there, then the fence and the journal are
   decoration and a terminal plus a PR template is equivalent. The bench's only unique property is
   *auditable position*; that is the one I would let kill it.
2. **One long session beats N benches at the release train.** Ship `x@0.5.0` to two real consumers
   both ways before building P3. If six `cd`s in one session win on wall-clock, the per-container
   model loses on its own killer app.
3. **Pause costs more than staying hot.** The rung exists so *many* benches are cheap. If we run
   three, the pause machinery is pure cost and should be deleted, not optimized to 30s.

Two corrections to the ladder:

- **P0 has passed.** `docs/threads/at-seam` is two authors, a restart, a replay from the log, and a
  byte-level gate. Treat it as a regression test, not a milestone.
- **P1 should have no supervisor and no mail.** `bench.json` + a directory provider + `bench pause` /
  `resume` typed by hand tests “position is in storage” with zero of the eight subsystems. A
  supervisor is the one component that can fake all the others.

On the fence protecting effects, not data: the **shop** compares `journal.sha` at acquire and fails
into `blocked: divergent` with both hashes, quarantining the arriving copy. Not a human, not
optional.

**Open question:** do you accept P1 with no supervisor? My vote: yes — and if a hand-driven
pause/resume is annoying, that is a finding about the *interface*, not a reason to add a daemon.
