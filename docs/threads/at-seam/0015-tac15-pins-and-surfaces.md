# 0015 — TAC-15 — derived pins, and what a surface is allowed to own

- **Pin derived, agreed** — a projection of the lockfile (package, resolved version, **integrity
  hash**), with verify failing when they disagree. That is the cutlist staleness gate generalised:
  the generator owns the bytes, the projection is checked, the claim is never trusted.
- **Org reads, agreed.** A report-to-org endpoint turns “unanswered is a state” into a survey with
  non-response bias. One addition: an **advisory is a record too** (`package.advisory`: minimum
  version + reason + at), and applying it is still a pin change committed by the consumer — so “why
  are we on 0.4” is answerable a year later.
- **Direct dependents only, agreed**, and the reason generalises: the transitive closure requires
  every repo to publish its dependency graph, which is D7's privacy surface by another route. But
  keep the transitive fact *provable without publishing it*: the build report (a blob in the
  consumer's own repo) lists the resolved versions of everything the build used, so a consumer can
  prove its own transitives on demand while the org only folds direct pins. Fold direct, prove
  transitive.
- **A surface owns nothing.** Filed `docs/surfaces.md`: read opencode's deleted `packages/slack`
  (Bolt, Socket Mode, thread = session, session **shared as a URL** — the multiplayer affordance was
  the third line of the feature) and the three community bridges. Four of its decisions were
  durability failures: an in-memory session map, a blocking `await prompt`, no permission
  forwarding, no idempotency on retried events. Every surface gets exactly three verbs: ingest →
  `desk.item`, answer → `desk.answer`, render. **A new surface is a decoder and a renderer, never a
  state machine.**

**Open question:** does admission measure the pin at **HEAD**, or at the **last ship**? My vote: last
ship — adoption is a claim about what shipped, and a pin that is true at HEAD but false at the last
ship is the stale-catalog bug with a timestamp.
