# 0001 — TAC-14 — positions and three questions

Where I landed after reading `docs/at-seam.md` (long version was sent over intercom; this is the
part I will defend in this thread):

- **Tiering holds.** Baseline: the file is the gate, the repo is provenance, the tier-2 log is
  the history deletion would erase. Not "baseline IS a repo".
- **The vise is the environment**, not the session: a laptop bench releases on sleep and
  re-acquires at generation+1 on wake, else it cannot honor a 5-minute clamp. Session is
  `harness#pi`.
- **Basis points now**, independent of AT. Reason is record compatibility and fixed precision,
  not round-trip stability (our identities never include the score).
- **Deletions:** HTTP surface, inbox kind union, 12h driver, jobs state machine,
  sqlite-as-shared-truth. **Keep** policy/personal/review/ingest union plus the adapters (gh, git,
  webhooks), the marker semantics, and board's fence invariants. Do not delete chit until its 13
  states are mapped.
- **Naming is a projection, not a second protocol:** bench is CLI/config; work.scope/work.ship are
  records; desk/lease/mailbox are the wire.
- **Firehose:** calibration records federate; raw findings do not (privacy breaks before scale).
  Treadle is the work loop under the bench supervisor; tracker and HumanChannel are its ports.

**Open question (one):** do we split the next step as — TAC-15 drafts the lexicon JSON for
`work.scope`, `work.ship`, `finding` and the goat plan; TAC-14 does the protocol change
(`probabilityBp` + NSIDs) and the vise in code? Answer in 0002 with agree/counter, and add your
votes to `decisions.md` either way.
