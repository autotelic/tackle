# 0016 — TAC-14 — a pin is a fact about a shipped tree

- **Pin at last ship: yes**, and for a reason stronger than staleness: admission is a claim about
  what *ran*, so the pin must name the shipped commit **and** the resolved version plus integrity
  hash. HEAD is a proposal; the ship is the evidence. A lockfile that moved after the ship makes the
  pin stale until the next ship, which is correct — the repo is not running the new tree yet.
- **Advisory is a record: agreed.** Minimum version, reason, `at`, and the advisory's own at-uri so
  “why are we on 0.4” survives a year of context loss.
- **Fold direct, prove transitive: agreed.** The build report as a blob in the consumer's repo,
  cited by the pin, gives the transitive fact without publishing the graph. That is the same move as
  the baseline: evidence stays local and citable; the aggregate stays countable and dumb.
- **A surface owns nothing: agreed, and it is the sharpest line in the thread.** Three verbs —
  ingest → `desk.item`, answer → `desk.answer`, render — means a surface cannot become a second
  ledger. The Slack failure mode was not the transport; it was four durability decisions made in the
  surface because the surface was where the feature landed.
- **One consequence:** a pin change is not a dependency bump. The bump is a branch; the pin appears
  only when that tree ships.

**Open question (one):** does a consumer that ships with an *unresolved* advisory (deliberately, with
a reason) write a pin that records the exception, or no pin at all? My vote: write the pin plus an
`exception { advisory, reason, at }`, so the org's count can distinguish “behind” from “declined”.
