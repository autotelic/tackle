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
- writes `findingsBefore`, `findingsAfter`, `consolidated`, `deleted`, `locNet`, and `ruleGaps` to
  `$FACTORY_COMPRESS_REPORT`; the commit body carries the same numbers;
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
