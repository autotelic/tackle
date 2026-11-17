# @autotelic/joggle

## 0.6.0

### Minor Changes

- 18a391e: A committed ledger line is now the key and the answer, nothing else. It used to carry
  `writtenAt`, which made the same answer a different line in every clone: `merge=union` keeps both
  sides of a differing line, so each rebase of a 21-branch stack copied every answer again — 5,890
  answers became 131,440 lines, 20.5 MB for 0.9 MB of content, one key copied 141 times. With the
  line a function of the key, a merge collapses duplicates by construction. Old stamped lines are
  still read; ages now live only in the machine cache, which is what `--max-age` prunes.

  `joggle cache compact` repairs a ledger that already grew: it reads each key once and rewrites the
  set, no re-judging and no key. `joggle cache report` now names the duplication.

  A scoped run (`--since`, `--pr`, `--changed`) writes its answers to the machine cache instead of
  the committed ledger, unless `--cache-dir` names a store. A branch's verdicts are a cache; the
  committed ledger is the trunk's.

## 0.5.0

### Minor Changes

- 461ec12: `--update-baseline` now refuses a scoped run (`--since`, `--changed`) and says why: a scoped
  run's identities are not a subset of a full run's, because a site can fold to a different
  survivor when the candidates outside the scope are missing, so the ledger can miss exactly the
  identity CI's full run reports. `--allow-scoped-baseline` accepts the risk explicitly.

  This turns a silent gap into an error at the moment someone tries to accept from a partial view
  — the failure a 21-branch stack hit as "a scoped accept reported 4 novel, CI failed on an
  identity that was never in the ledger". A scoped run is for the gate; acceptance is one full run
  at the head. Aliases on a folded survivor, so the ledger can match either identity, is the fix
  that would make scoped accepts sound; until it exists, refusing is the honest state.

## 0.4.5

### Patch Changes

- fc1dc07: A run says when the judgement cache passes 8 MB, and names the cap: `joggle cache prune
--max-bytes 4000000`. A committed answer cache buys keyless replay and costs bytes in every
  clone; GitHub warns above 50 MB per file and refuses above 100 MB, and a deep stack multiplies
  it because each branch's scoped accept adds answers to the same committed file. JOGGLE.md and
  docs/artifacts.md state the ceiling for the committed mode, and when a cache can stop being
  committed at all (only with a key: without one the identities change).

## 0.4.4

### Patch Changes

- bbad900: `--update-baseline` reports findings no ledger can ever hold: `N finding(s) declare no
identity, so no baseline can accept them; they will appear in every run`. Without it, "accepted"
  read as "quiet", and the finding came back in the next run with no explanation.

## 0.4.3

### Patch Changes

- 4998735: A scoped run's fold note now says what the fold costs a ledger: the folded finding has no
  identity in this run, so an accept taken from a scoped run can be missing exactly the identity a
  full run reports. JOGGLE.md and the jig cookbook say the same in the stack recipe — a scoped
  accept is necessary, not sufficient; the full run is the authority.

## 0.4.2

### Patch Changes

- e52f439: JOGGLE.md documents the stacked-branch cascade: conflicts are the easy half (every one is a
  committed artifact, so `git rebase -X theirs <parent>` clears the text and the artifacts are
  rebuilt), and the ordering is the hard half — accept and rebuild on every branch first, then
  rebase bottom-up once, then push once with `--force-with-lease`. Also notes that an interrupted
  rebase leaves `rebase-merge/`/`index.lock` blocking the next branch, and that a scripted
  cascade belongs in a trap that aborts.

## 0.4.1

### Patch Changes

- c44f5ed: `--update-baseline` says when it wrote nothing: an empty ledger is still written, and the
  report now carries `wrote 0 identities to <path>: nothing new to accept`, so a caller's merge
  step does not have to infer "nothing new" from an empty array — or from a file it never
  checked for.

## 0.4.0

### Minor Changes

- e6a6d56: `--merge-baseline` unions a run's identities with the ones already in `--update-baseline`'s
  target instead of replacing them. A scoped run (`--since`) judges every file it reads, so its
  identities are a pull request's worth: merging grows the committed ledger by one change rather
  than re-judging the repository, which on a stacked branch is a 25-minute run that still refuses
  to write.

  A `.json` ledger is written as a set, so re-accepting an identity cannot duplicate a row. The
  `--update-baseline` refusal now names the model key, the token budget, and the scoped recipe
  rather than "judge the run first".

## 0.3.0

### Minor Changes

- 85cdfac: The committed ledger is one file by default; sharding is the opt-in.

  A shard per key prefix turned a 182-entry ledger into 130 files, and `git
cannot ship a merge driver in `.gitattributes`, so the merge granularity it
bought was unavailable on most clones anyway. `answers.jsonl`— one sorted line
per answer — is now what joggle writes: a verdict change is one visible line, and
git's built-in`merge=union` merges concurrent judging.

  - `cache.layout: "sharded"` (or `joggle cache migrate --layout sharded`) keeps
    the sharded form for a store big enough that a whole-file rewrite or a merge is
    a real cost. Both layouts are read; `cache migrate` now defaults to `single`
    and moves between them in either direction.
  - `joggle cache report` names the layout and the file count.
  - The older `answers.json` object and both earlier `.joggle/.gitattributes`
    banners are migrated in place on the next write.

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
