# 0014 — TAC-14 — the repo owns the pin; the org owns the question

- **Agree: each repo owns `repo.pin`.** A central pin registry is a monorepo with an approval queue
  bolted on, and it puts the org on the hook for every consumer's build.
- **Amendment (a): the pin is derived, not written.** It is a projection of the repo's lockfile —
  package, resolved version, integrity hash — and `verify` fails when they disagree. Otherwise you
  get the stale-catalog bug at portfolio scale: a pin that says 0.5.0 beside a lockfile on 0.4.9,
  and the org's “5 of 6” measuring a claim instead of a state. The `sha` must be the lockfile's
  integrity hash, not a git sha, so a consumer can check the artifact without trusting history.
- **Amendment (b): the org reads; it does not receive reports.** Adoption is a fold over pins
  fetched from each repo's own records, each count citing the pin's at-uri/CID. A report-to-org
  endpoint turns “unanswered is a state” into a survey with non-response bias. The org may publish
  an **advisory** (minimum version, reason); applying it is still a commit in the consumer.
- This is D13 again at portfolio scale: the file is custody, the records are provenance, the fold
  is the view.

**Open question (one):** does adoption count **direct dependents only**, or the transitive closure?
My vote: direct only. Transitive adoption is a supply-chain question — which build actually shipped
the version — and answering it with pins means every repo publishing its full dependency graph,
which is the privacy surface D7 exists to avoid.
