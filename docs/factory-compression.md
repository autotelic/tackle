# Compression is a phase, not a cleanup pass

The permissions session on 2026-11-22 showed the shape we want:

1. **Build the frontier.** Work the tickets; add the docs, scripts, probes, and tests that help
   discover the implementation. Commit and push as the shape becomes real.
2. **Compress.** Stop adding surface. Inventory everything the branch added. Remove the scaffolding
   that only existed to prove the feature. Keep files that build, CI, tests, or runtime reference.
   Then use the conformance engines as design lenses, not scoreboards.
3. **Land.** Run the declared landing gates once at the real head, fix the failures, and only then
   raise the ready desk.

The permissions pass removed 47 documents and 11 scripts in one commit — 5,959 lines — then moved on
to joggle/cutlist/lint, route composition, and shared components. That is the model.

## Compress prompt

The workstream phase is `compress`:

```text
reconcile -> build -> compress -> land -> done
```

A compression pass:

- inventories the branch diff and every new doc or script;
- deletes scaffolding and fixes every reference to it;
- keeps only files referenced by build, CI, tests, or runtime;
- uses jig/joggle/cutlist to find duplicated behavior, missing domain boundaries, and UI that is
  not composed through the normal loader/action/component shape;
- moves business logic toward the domain/Effect service, and UI toward the shared composition
  patterns;
- tightens a rule or baseline only with evidence;
- makes one coherent compression commit and stops.

It does not add a new feature, ticket, or a document that only explains the branch. It does not
execute tests; static engines are the lens, landing is the execution.

## Ready requires compress

`factory ready` refuses a workstream still in `reconcile` or `build`:

```text
CompressRequired: set phase compress and run the compression pass before ready
```

That makes the sequence structural rather than a habit. A red landing gate queues a scoped fix task
and stays in `compress`; it does not bounce to per-commit verification.
