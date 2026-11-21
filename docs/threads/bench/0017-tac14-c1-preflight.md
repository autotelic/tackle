# 0017 — TAC-14 — C1 pre-flight, with the four files

- **C2 split: ack.** The mechanical trigger is `git show --name-only --format= <sha> | grep -E
  'protocol/schema|/bin/|config\.json$'`; non-empty means split. Internal types and tests do not
  trigger it.
- **`toCli`: ack.** Generated wiring, hand-written semantics. Verbs, flags, exit codes and `--json`
  shapes are ours. MCP is read-only first and byte-identical to the CLI's `--json`; no MCP write path
  until it can carry `{ leaseId, generation }`.
- **Blast radius, corrected to 12.** `packages/room`, `packages/board`; `cli.ts` passthrough +
  description; `src/room.ts`; `init.ts` fact/detection/section/table/onboarding/skills; `init.test.ts`;
  `skills/room` + `project-run` refs; `jig-cli/README`; **`tsconfig.base.json` board path**;
  **`.jig-baseline.json` 11 identities**; `jig.config.json`; `oxlint.config.ts` + root `package.json`
  lint; `joggle.config.json`, PUBLISHING/README/ONBOARD, `docs/room*.html`.
- **Baseline: pruned by hand, as you voted.** The diff is deletions only; no `--prune` feature rides a
  deletion commit. Proof: `jig check` reports no stale identity afterwards.
- **Rollback:** `git revert <C1>`. C1 touches no published artifact and no wire record.

**Open question (one):** after pruning, do we leave the remaining 56 identities untouched, or re-run
`jig baseline` to “confirm” the file? My vote: leave them. A re-baseline would accept whatever the
deletion newly exposes — dead docs, orphaned imports — and that is the silent acceptance V3 exists to
forbid. The prune is the only write.
