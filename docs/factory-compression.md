# Compression is a phase, not a cleanup pass

The permissions session on 2026-11-22 showed the shape we want:

1. **Build the frontier.** Work the tickets; add the docs, scripts, probes, and tests that help
   discover the implementation. Commit and push as the shape becomes real.
2. **Compress.** Stop adding surface. Inventory everything the branch added. Remove the scaffolding
   that only existed to prove the feature. Keep files that build, CI, tests, or runtime reference.
   Then use the conformance engines as design lenses, not scoreboards.
3. **Land.** Run the declared landing gates once at the real head, fix the failures, and only then
   raise the ready desk.

The permissions pass removed 47 documents and 11 scripts in one commit — 5,959 lines — then kept
cutting: 27 commits over about two and a half hours covered joggle/cutlist/lint, route composition,
shared components, hooks, and decoded API boundaries. Compression is a loop of small cuts, not one
mythical pass. Each cut is its own commit/push; the phase ends when the branch stops yielding
duplication or scaffolding.

## Compress prompt

The workstream phase is `compress`:

```text
reconcile -> build -> compress -> land -> done
```

A compression pass is one cut in that loop, with five obligations:

- inventories the branch diff and every new doc or script (remove memorialisation);
- deletes scaffolding and fixes every reference to it;
- keeps only files referenced by build, CI, tests, or runtime;
- cutlists the UI this branch touched and assembles from existing primitives, hoisting at the third use;
- names the primitives each new component should be made of and fixes the ones that are not;
- reports every rule gap to the tackle session with file and rule id, instead of silently working around it;
- uses jig/joggle/cutlist to find duplicated behavior, missing domain boundaries, and UI that is
  not composed through the normal loader/action/component shape;
- moves business logic toward the domain/Effect service, and UI toward the shared composition
  patterns;
- tightens a rule or baseline only with evidence;
- writes `findingsBefore`, `findingsAfter`, `consolidated`, `deleted`, `locNet`,
  `generatedLocNet`, `generatedFiles`, `effectBefore`, `effectAfter`, and `ruleGaps` to
  `$FACTORY_COMPRESS_REPORT`; the commit body carries the same numbers. Generated catalog/snapshot
  churn is reported separately; it is not counted as compression;
- makes one coherent compression commit, pushes, and stops; the next compression event is another cut.

It does not add a new feature, ticket, or a document that only explains the branch. It does not
execute tests; static engines are the lens, landing is the execution.

## Ready requires compress

`factory ready` refuses a workstream still in `reconcile` or `build`:

```text
CompressRequired: set phase compress and run the compression pass before ready
```

That makes the sequence structural rather than a habit. A red landing gate queues a scoped fix task
and stays in `compress`; it does not bounce to per-commit verification.

## Rule feedback from the first compression passes

The phase is also an audit of the engines:

- **jig rung / `joggle/unparsed-output`** — the joggle engine exits 3 with “unparsed output”
  through jig while the same command exits 0 in a shell. The branch gate therefore counts zero
  joggle findings. Fix: a JSON or structured invocation in the jig engine config, or a parser that
  understands joggle’s native report; do not let “engine could not run” become “no findings”.
- **cutlist primitive adoption** — a route hand-rolled two `<button>` elements while
  `components/ui/button.tsx` existed, and cutlist reported zero. Add a primitive-adoption finding
  for hand-rolled button/link where a tier-“primitive” component matches.
- **joggle duplicate implementation** — the rule saw four copies of the folder column list and a
  duplicate `VIEWERS` constant, then declined. They were consolidated by hand. The rule needs a
  “duplicate structure, not just duplicate name” path.
- **same-file repeated scan** — projects `route.tsx` had four memos scanning one list for different
  columns; no engine flagged it. Add a repeated-predicate/repeated-scan rule.
- **joggle/single-path false positives** — it matched unrelated imports to a resource constant,
  query string, and boolean. Bind the flagged value to the construction, not the file’s imports.
- **joggle/unaccounted-drop misfires** — pure partition/group helpers return every item and are not
  funnels that drop a count; the rule should not ask for explanatory prose there.
- **plumb/effect/typed-error missing** — `documentation/refusals.ts` shipped
  `type Refusal<R> = { refusal: R }` plus eleven literals and plumb reported zero. The shipped
  `tools/oxlint/guardrails/effect.cjs` is a no-op shim, so no rule asked for `Data.TaggedError`.
- **joggle tagged-error factory** — joggle/duplicate-implementation saw eleven one-line refusal
  classes, judged “same shape, nothing to change,” and proposed no factory. The cut was done by
  hand instead of by the engine.
- **jig joggle rung** — unchanged: joggle exits 3 through jig and 0 in a shell, so the gate still
  counts zero joggle findings. Direct `joggle check --since origin/main` was clean (169 judgements,
  1 unjudged), but the jig rung must be fixed rather than bypassed.

Effect v4 target: `Data.TaggedError` + `Effect.catchTag` for typed failures, `Clock`, `Logger`,
`Schema.decodeUnknown`, `Context.Tag` + `Layer`, `Schedule`/`Effect` for retries and limits. The
receipt reports `bespokeErrorUnion`, `throwCount`, `dateNow`, and `consoleLog` before/after for the
touched set, so “we left it better” is measured instead of asserted.

These belong in the rule backlog with file and rule id attached; they are not reasons to weaken
compression.
