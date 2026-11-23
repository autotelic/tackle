# @autotelic/cutlist

## 0.0.4

### Patch Changes

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

## 0.0.3

### Patch Changes

- f8e19ba: Pin `@effect/platform-node-shared` as a real dependency.

  `@effect/platform-node` constrains its shared package with a caret and nothing else, so a
  consumer whose lockfile resolves that caret upward got a shared package built for a newer
  Effect than the one the tool pins: `cutlist@0.0.2` died on `effect/dist/process/CommandLine.js`
  in a repository that also had Effect 4.1. The workspace `overrides` hid this locally; a
  dependency is what publishes, and no package declared one. Both published tools now do, and
  `scripts/check-catalog.mjs` now fails when a package uses `@effect/platform-node` without
  pinning the shared package beside it, so the next tool cannot publish with the same gap.

## 0.0.2

### Patch Changes

- Updated dependencies [c7c94bf]
  - @autotelic/protocol@0.1.1

## 0.0.1

### Patch Changes

- 4723293: Records and lexicons, and per-lexicon versions.

  `@autotelic/protocol` is now a registry of named, versioned record formats rather than four
  loosely-related modules. Every tool-written record carries `lexicon: { name, version }`;
  each lexicon versions on its own line, so `report` can evolve without a reader of
  `baseline` re-reasoning. The global `PROTOCOL_VERSION` is gone; a record written before this
  change (carrying `protocolVersion`) is still accepted by every decoder, forever.

  New in the package: pure defensive decoders for every lexicon (malformed input degrades to
  silence), JSON Schema for `manifest`, `menu`, and `onboarding` (which had none), golden and
  malformed fixtures, a frozen compatibility corpus with `scripts/lexicon-compat.mjs` wired
  into `pnpm check`, a conformance matrix, an independent Node reader, and a language-neutral
  spec for the report → SARIF/LSP/Code Climate projections (`docs/projections.md`).

  `cutlist` writes the catalog and manifest with the catalog lexicon; `jig` writes the baseline
  with the baseline lexicon. Both regenerate their committed exemplar artifacts.

- Updated dependencies [d312ebb]
- Updated dependencies [db85419]
- Updated dependencies [cdca144]
- Updated dependencies [4723293]
  - @autotelic/protocol@0.1.0
