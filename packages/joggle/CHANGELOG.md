# @autotelic/joggle

## 0.2.0

### Minor Changes

- eb236d8: Discovery follows the root through symlinks, and the committed ledger is reviewable.

  `tsgo --listFilesOnly` prints the path it resolved, so a cwd of `/tmp/x` (where `/tmp` is a
  symlink) listed `/private/tmp/x/...` and the lexical root comparison rejected every file: the
  run reported "tsgo listed no source files" and analysed nothing. Roots are compared and returned
  through their real paths now, in the caller's spelling of the tree.

  `--update-baseline` refuses while any candidate was not judged (`unreadable`, `no_evidence`,
  or past a budget), because a baseline records what a person reviewed. `--allow-unjudged-baseline`
  is the explicit override, and the run always says how many candidates nobody looked at.
  `decision.maxInputTokens` puts the token budget in `joggle.config.json`; `--max-tokens` still
  wins.

  The answer ledger is now text-diffable and merges without per-machine setup: the generated
  `.joggle/.gitattributes` names git's built-in `merge=union` instead of a custom driver that only
  worked where somebody had registered it by hand, and drops `-diff`/`linguist-generated` so a
  verdict change is one visible line. The older banner is migrated in place. `joggle cache report`
  renders entry and shard counts, verdict distribution, labels and the date range beside the diff.

## 0.1.2

### Patch Changes

- da20164: First release published through npm's trusted publisher, so these tarballs carry a provenance
  attestation like the rest of the family.

  Every earlier version was uploaded with a token from a maintainer's machine. Provenance is the
  record of which repository and workflow built the tarball; `npm audit signatures` can check it,
  and it is the one thing a token-based publish cannot produce.

  `@autotelic/board` also declares `sideEffects: false`: it is Effect schema definitions and
  nothing else, so a bundler may drop what a reader never uses.

## 0.1.1

### Patch Changes

- 8799224: Retire the stored run when the config changes, and deliver a report larger than a pipe buffer.

  The run manifest hashed the rule IDS and never how they were configured, so editing
  `joggle.config.json` did not invalidate `last-run.json`: a severity moved to `error`, a path
  added to `ignore`, an architecture renamed, and the next run replayed a stored report for a
  configuration that no longer existed. The manifest now carries a `settings` component — the
  decoded config and the run's own switches — so any config edit is a miss.
  `tests/config-invalidation.test.ts` runs the same repository twice (replay, then re-run) and
  `tests/fingerprint.test.ts` pins the hash itself.

  `write` used `Console.log`, which queues the write and returns; the teardown then ends the
  process with `process.exit`, discarding whatever was still queued. A report past the pipe's
  64 KiB buffer — this repository's is 97 KB — was cut off mid-sentence when piped, which is how
  CI and `jig` read it, so `jig` reported an unparseable engine and every finding was lost.
  Measured against this repository: piped, `check --format json` delivered 65 536 bytes and would
  not parse; with the write callback, all 97 020 arrive.

- a4498a3: A yes/no whose repeated asks split is reviewed, not acted on.

  A Noul is asked three times and its agreement becomes its margin, so that it is gated like a
  Choice. The mapping (`2 × agreement − 1`) gave a 2-1 split a margin of 0.33, over `minMargin`
  (0.25), so a split whose mean cleared the 0.5 floor was reported at the rule's full severity
  even though one ask said no. A 2-1 split is what three fair coin flips produce three times in
  four; it is no evidence the model was decisive. `policy.decision.gates.minAgreement` (1) now
  sets the share of asks that must agree before agreement counts as a margin, and below it the
  margin is 0, so `qualityOf` routes the answer to review.

  The gate is policy, not part of the judgement cache key, so every committed answer still
  replays and nothing is re-judged. In this repository's caches, 12 of 549 repeated Nouls split,
  and the 6 above the floor move from their rule's severity to `info`.
