# @autotelic/cutlist

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
