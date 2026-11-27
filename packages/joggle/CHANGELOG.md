# @autotelic/joggle

## 0.14.2

### Patch Changes

- `duplicate-implementation` sees a copy in the same file.

  `distinctFiles: true` made every duplicate rule blind to the cheapest kind of
  duplication there is: `bundles.ts` carried `blocksIn` and `declares` three lines
  apart with identical bodies and nothing fired. The join now allows same-file
  pairs, with `distinctNames` still required so a declaration is not compared with
  itself. Measured on this repository: 60 clusters before, 71 after — eleven of them
  same-file copies.

  `DeclarationQuery` also carries `canonical?: boolean`, so a caller can ask for
  canonical type ids without turning them on for every declaration of a repository.

## 0.14.1

### Patch Changes

- Canonical type ids are opt-in until the checker walk is batched.

  `typeIdOf` asks the sidecar for `getPropertiesOfType`, `getTypeArguments` and
  `getTypeOfSymbol` per declaration, and `resolveDeclarations` asked it for every
  one. Over this repository that was a 4GB heap and an out-of-memory crash for
  `joggle check packages`, and a single-package scope stopped finishing at all
  (>120s where it had taken 1s).

  `policy.canonical` now defaults to false and the field is `""`, meaning "not
  computed", never "computed and empty". Measured after: the same repository-wide
  run is **3.5s for 877 files and 4,849 declarations**, and the scoped run 2.2s.

  The ids are correct; the cost is the batching. `getTypeAtPosition` is already
  batched per file; the type-graph walk is not, and turning this on before that is
  a memory hazard rather than a slow function.

## 0.14.0

### Minor Changes

- New relation and rule: containment, `joggle/containment`.

  Jaccard divides by the union, so a declaration that is a specialization of
  another collapses as the size gap grows: a pair can share every bigram of the
  smaller side and still score far below the duplicate threshold. No threshold on
  Jaccard recovers what its denominator throws away. Containment divides by the
  smaller side, so the subset relation survives — on this repository 6,589 pairs sit
  at containment 0.8 or above, with Jaccard as low as 0.17.

  The rule reports those pairs, ranks them by rarity so test scaffolding and shared
  idiom fall away, and asks one question: is the smaller a specialization of the
  larger, or two unrelated things that share tokens.

- Content-addressed identity for declarations: `joggle identity <paths...>`.

  A declaration's id is a Merkle hash over its own structure. Bound names become
  positions, the declared name is erased, free references resolve to the target's
  own id, and mutually recursive groups key from their sorted member hashes with
  the cycle removed. `HASH_VERSION` rides in every id, so a normaliser change is a
  visible migration rather than a silent re-interpretation of an old id.

  Proven on this repository: `packages/jig-cli/src/version.ts` and
  `packages/cutlist/src/version.ts` — identical by token bag — share every id, and
  each file loaded alone yields the same ids as loaded together. A rename is inert
  for identity; a changed literal is not.

  `fragmentsOf` exposes the subtree ids and `dependentsOf` the declaration-level
  reverse index a collapse proposal needs.

- Canonical type identity, from the checker's type graph rather than its printed text.

  A type's printed form is not its identity: `Box<A>` and `Cell<T>` print
  differently and are one shape, while two Effect programs differing only in their
  error channel print almost alike and are different programs. `typeIdOf` walks the
  `@typescript/native` async `Checker`: union and intersection members sorted by
  their own ids, tuples and literals encoded, type parameters as de Bruijn
  positions, a referenced declaration as its content id, and a cycle keyed by that
  id so a recursive type terminates and stays stable.

  It is a pre-filter, not an oracle: `identicalGroup` (mutual assignability) remains
  the authoritative answer, and the two are kept beside each other deliberately.

## 0.13.0

### Minor Changes

- New rule `joggle/underused-primitive`: a capability hand-rolled in this
  repository that an installed dependency already exports.

  The signal is an ABSENCE, which no existing join could see: the dependency is
  never called, so there is no duplicate to compare. The candidate is a syntactic
  evidence kind (one today: a failure kind spelled `class X extends Error` or a
  type carrying `_tag`) crossed with an export nobody imports, judged against the
  one export that would replace it.

  Proven on this repository rather than argued:

  packages/board/src/Supervisor.ts — 9 declarations do tagged errors by hand and
  TaggedError from effect/Data is imported nowhere.

  `joggle surface build` writes the surface (machine-local, never committed);
  `joggle surface --check` gates staleness. The catalogue holds one kind on
  purpose: three duration shapes were deleted because the model declined every one
  of them, correctly — `Duration` represents a length of time, it does not remove
  a literal.

### Patch Changes

- Updated dependencies
  - @autotelic/protocol@0.2.0

## 0.12.0

### Minor Changes

- New rule `joggle/restated-value`: a vocabulary declared in more than one place.
  It claims the `values` join key, which the candidate generator has declared and
  implemented since it was written and which no rule read.

  Two fixes the rule made visible in the shared layer:

  - `unit.typeSignature` now resolves a name by what it is rather than by where it
    was mentioned. A global such as `ReadonlyArray` resolves to its bare name, a
    locally declared type keeps its own file, and an imported name keeps its
    exporting file. `joggle/duplicate-implementation` reported zero findings on
    this repository before this change -- identical helpers in different files
    carried different signatures, so the shape join never grouped them -- and
    reports five clusters after it.
  - `joggle/restated-value` excuses a declaration only when its file imports that
    declaration from its home, not when it imports anything at all from the same
    file.

## 0.11.0

### Minor Changes

- 390f4fa: Three plumb rules read the agentic prose register in comments and string
  literals: `no-prose-verdict`, `no-antithesis-clause` and
  `no-anthropomorphic-program`. They are at `error` in this repository, with
  documented exemptions for spec files and for the three rule sources that quote
  the phrases they report.

  joggle gains `prose-voice`, a judged rule that reads JSDoc prose, Markdown and
  multi-word string literals, and `joggle prose`, which judges a commit message or
  a pull request body without walking the repository. Discovery now carries
  Markdown on `Workspace.prose` instead of counting it in `skippedExtensions`.

  `prose-voice` also carries six semantic labels from Clark, Martin and Mahowald
  (2026): `compression`, `stacked_nouns`, `reduced_relative`,
  `inanimate_subject`, `denominal` and `long_dependency`. They name a
  processing cost, not authorship: the existing candidate filters are unchanged, and
  there is no dependency parser and no frequency table.

### Patch Changes

- Updated dependencies [260ee08]
  - @autotelic/protocol@0.1.2

## 0.10.2

### Patch Changes

- 6530246: Share protocol's severity ranking instead of keeping a second copy.

  Re-judging this workspace after treadle joined reported `joggle/duplicate-meaning`:
  `rank` in joggle's report duplicated `severityRank` in protocol, the package that owns the
  report format. Joggle now depends on `@autotelic/protocol` — the direction the dependency law
  already names — and sorts with the one ranking, so a severity ordering cannot drift between the
  format and a consumer.

## 0.10.1

### Patch Changes

- 67961a5: A progress line whose units add up, and a baseline refusal that names the real cause.

  The progress line printed the WIRE request count as "resolved". That is a different quantity: a
  replayed candidate never makes a request, and one batched call can answer many candidates, so a
  ten-minute run reported "198/10040 resolved (31 judged, 9731 replayed)" while writing 17,000
  answers. The counters are now three distinct units — `judged` (answers written, one per
  candidate), `replayed` (per-decision cache hits), `apiCalls` (provider requests) — and
  `resolved` is their terminal sum with `unavailable`. The progress document carries the same
  fields, plus `unavailable`.

  `jig baseline` refused with "joggle reads its model key from this run's environment" whether or
  not the key was present. On a repository that sets `unavailable: "count"`, the key IS present and
  the candidates are still unjudged — a per-rule ceiling, not a missing secret. The refusal now
  states which case it is, says that no key can raise a ceiling, and points at `--allow-unjudged`
  for a repository whose engine policy already declares that unjudged is expected.

  The README also states the direction that works: accept from a KEYED run once, and both modes
  pass, because a keyless run sees a subset of a keyed ledger. Accepting keyless and then running
  with a key fails by construction.

## 0.10.0

### Minor Changes

- 0487a0b: A finding's identity no longer depends on whether a judgement reached it.

  A cluster's identity included **the symbol the model chose to keep**, so the same duplicate had
  one name when a keyed run judged it and another when CI ran keyless — and a ledger written in
  either mode matched nothing in the other. That is why a developer with a key could not run the
  gate unscoped and pass, and why "the engine ledger owns the bulk, the gate ledger stays short"
  could not hold.

  Identities are now the rule and the cluster's **members** (`file:name`, sorted, no line
  numbers): membership is decided by the detector, before any question is asked, so keyed and
  keyless runs agree. Verified on this workspace: the keyless identity set is a subset of the keyed
  one, with zero renames (the keyed run adds findings; it no longer moves them).

  **This renames the ledger, once.** Accepted identities written by joggle before this release will
  not match; re-run `jig baseline` on the default branch (and the engine's `--update-baseline`)
  after upgrading. The gate's report names the difference as new findings, so nothing is lost
  silently.

  Three related corrections:

  - `jig baseline` refused any ledger containing a **deterministic** finding, because such findings
    are marked `judged: false` — an exact duplicate has no question to ask. It now refuses only when
    an engine actually skipped judgement (its census reports unjudged candidates), and says how many.
  - The baseline refusal quotes the **per-rule ceilings** that dropped candidates, so a run that
    stopped at a constant no longer sends the operator to `--max-tokens`, which cannot raise it.
  - `jig init --force` no longer replaces a repository's decisions: an existing layer's `include`
    set is kept (it is authored intent, not a draft), and a JIG.md/ONBOARD.md that differs from the
    generated text is left alone with the fresh copy beside it as `.new`.

## 0.9.0

### Minor Changes

- 94aca21: A long run says where it is, and the version a binary prints is the version on npm.

  A judged run of 13 minutes printed **nothing** — stdout and stderr at zero bytes until the report
  — so the only way to tell working from hung was to watch the answer cache grow. Two surfaces now
  exist, both optional and both machine-local:

  - **stderr, every 10 seconds**, counts only so every machine format on stdout stays clean:
    `joggle: 4210/7787 candidate(s) resolved (1234 judged, 2976 replayed) · 1.9M/4.0M input tokens · 13m20s`.
    Judged and replayed are named separately because "findings" and "findings no judgement reached"
    added into one number is a misread that already happened.
  - **a progress document**, rewritten atomically (temp + rename) on the same tick at
    `<machine cache>/progress.json`: `{ phase, candidatesTotal, candidatesResolved, judged, replayed,
apiCalls, inputTokens, inputBudget, elapsedMs, updatedAt }`. A CI log or an agent can poll it.

  `jig check` also announces each engine's start and finish on stderr, so the gap between concurrent
  engines is visible instead of being swallowed until the merged report.

  The answer ledger is now written atomically too: temp then rename, both layouts. A run killed
  mid-write leaves the previous whole ledger instead of a truncated tail, which the reader would
  have counted as skipped lines — losing answers silently.

  `jig --version` and `cutlist --version` print the package version plus the checkout's short sha
  (`jig v0.6.0+1a2b3c4`) instead of a hardcoded `0.0.0+<cwd sha>`, so an npm install and a checkout
  are distinguishable, and "is my install current" is answerable from the binary.

  One more line in the report: the headline separates findings from findings nobody judged
  (`… ; 7787 candidate(s) not judged; 5315 of these finding(s) unverified`).

## 0.8.2

### Patch Changes

- 6d59b6c: Report the version that is on npm, and judge a real repository's census.

  `joggle --version` printed a hand-typed "0.1.0" while the package released through 0.8.x, so a
  consumer comparing versions to prove a fix had arrived read a number that never moved. The
  version now comes from the package manifest, which is the one place a release writes; every
  cache document that stamps it gets the same correction.

  Four per-rule candidate ceilings were also the reason a baseline could not be written on a
  mid-size repository: the slices are deterministic, so candidates past the ceiling were never
  judged by any later run, and `--update-baseline` refused with "candidates were not judged".
  The ceilings now fit the measured tree (679 documented declarations, 408 string sites, 538
  staleness projections), the refusal message distinguishes a slice ceiling from the token
  budget, and the root gate is green over a complete census.

## 0.8.1

### Patch Changes

- a061858: A run counts the judgements it took from a cache. An answer served from the committed ledger was
  not counted as replayed — only wire requests were — so a run whose findings all came from cached
  verdicts reported "0 replayed, 0 calls" and the census could not tell a warm machine from a cold
  one. That is exactly how a developer's tree reported 95 findings while a fresh clone reported 0:
  moving the machine cache aside changed the verdicts, and nothing in the report said a cache was
  involved. `decision.replayed` now counts both, and the note names them.

  0.8.0 could not be completed on the registry (a staged version required approval); 0.8.1 carries
  the same `--list-files` and `discovery` work.

## 0.8.0

### Minor Changes

- 0f51769: `--list-files` puts the analysed paths in the report's `discovery` block, and every run now
  carries `discovery` (`analysed`, `ignored`, `ignoredDirectories`, `truncated`,
  `skippedExtensions`) in `--format json`. Two checkouts of one commit that disagree have only two
  possible causes — a different analysed set, or a different verdict — and until now the JSON gave
  no machine-readable way to tell them apart: the census was prose in `notes`, and the file list was
  never emitted. Diff the two `paths` arrays and the answer is in the diff.

## 0.7.2

### Patch Changes

- 8752f2d: A checker-discovered file list now drops build output, the same way the directory walk always
  has. `--types` takes the file list from the checker, and a tsconfig's include is not a judgement
  about what is source: with `packages/*/dist` in the program, every declaration was analysed twice
  — once as written, once as built — and reported as "declared in two places". On one repository
  73 of 95 findings were that, and the count depended on whether the developer had ever run a build.

## 0.7.1

### Patch Changes

- 8f7ad45: A run says how it got its answers: "N judgement(s) were asked of the model in this run: a key was
  present" or "N judgement(s) were replayed from the answer cache; no model was called". A keyed run
  judges for itself and a keyless one replays, and the two can name the same site differently — which
  is the difference between a developer's machine and CI at the same commit. Without the line the
  report looks identical either way and the difference is found by bisecting a ledger.

## 0.7.0

### Minor Changes

- 010a06d: `--read-only` (and `JIG_READ_ONLY=1`, which `jig check` sets for every engine it starts) answers
  from the answer ledger and never writes it. A check must not edit the tree it judges, and here the
  stake is identity: a new answer _renames_ the finding it verifies, so a run that judged and wrote
  re-opened 91 findings in a rule whose ledger entries were intact, on files the change never
  touched. Warming the ledger stays deliberate — `joggle check` on trunk, or `--update-baseline`.

## 0.6.2

### Patch Changes

- b74b7c0: The docs say two things the field established on a real stack: deduplicating an old ledger by key
  is **safe on a keyless CI today** — the stamps were never load-bearing for replay, so a parked
  stack went 55.4 MB / 372,623 lines to 1.21 MB / 8,171 answers with the lint job still green on the
  same answers — and compaction is a commit, so a parent re-dirties every child. Compact bottom-up
  once, or compact the base branch after the stack merges.

## 0.6.1

### Patch Changes

- 9633fe2: The published package now runs on a clean install. Two dependencies were missing from the
  manifest while `dist` imports them: `@typescript/native` (statically imported by the type-fact
  layer, so every command failed with `ERR_MODULE_NOT_FOUND`) and `@effect/platform-node-shared`
  pinned beside `@effect/platform-node`, because that package declares `^4.0.5` for its own shared
  module and a consumer install floated it to a newer minor, killing the tool on a `NodeWS` export.
  Workspace `overrides` hid both; only a dependency reaches a consumer.

  Verified by installing the packed tarball into an empty project and running `joggle cache
compact` on a real 20 MB ledger: 125,550 duplicates away, 20,515,807 -> 844,906 bytes.

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
