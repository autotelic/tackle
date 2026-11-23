---
"@autotelic/plumb": minor
---

`plumb-effect/no-run-promise-outside-seam` is the seam rule the Effect rulebook was missing. An
Effect is a description, and `runPromise` is where one becomes a running process; every extra call
site is a second entry point with its own failure policy and its own test seam. The rule fires on
`Effect.runPromise` (and the namespace and named-import aliases of it) in every file the
application does not name in its `seams` option, so a handler that runs its own effect is a finding
instead of a convention in a comment.

Which defect it catches: a permissions workstream ran handler effects with `Effect.runPromise` in
the route module, so three failure policies lived in one file, the route could not be tested at its
seam, and the user had to ask for the seam twice. Test files are skipped: a test owns its runtime.
