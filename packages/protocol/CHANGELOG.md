# @autotelic/protocol

## 0.1.1

### Patch Changes

- c7c94bf: Declare the package side-effect free.

  It is types, JSON Schema, and pure functions: importing from it cannot change program state, so
  a bundler may drop what a consumer never uses. `sideEffects: false` is how a package says that;
  without it every import is assumed live.

## 0.1.0

### Minor Changes

- d312ebb: `EngineRef` gains an optional `args`, and `jig` resolves an engine from the project.

  A `jig.config.json` engine can now carry the arguments its invocation needs. `jig`'s `plumb`
  engine uses it to scope `oxlint` with `--ignore-pattern`, so a root run never builds a
  neighbouring repo's config (the exemplar's `.oxlintrc.json` names a plugin this workspace did
  not import).

  `jig` also looks for an engine's command in the project's own `node_modules/.bin` before it
  falls back to PATH. The census therefore reports what the project installed, not what the
  caller's shell happens to shadow — the workspace's `joggle` wins over a global install.

- db85419: The gate honors its config, and `jig check` publishes an exit-code contract.

  `report.format`, `gate.failOn`, and `gate.mode` were decoded and then ignored — knobs that
  lied. `jig check` now reads all three: `report.format` is the default when `--format` is
  absent; `failOn` chooses whether the gate fails on errors, errors-and-warnings, or (the
  default) any identity not in the baseline; and `gate.mode: "touched-files"` gates only on
  findings in files the working tree touches, widening to `all` when git cannot say rather than
  narrowing to an empty set that would pass everything. `report.maxWarnings` remains the
  second, severity-blind ceiling.

  The exit codes are now a documented contract: `0` clean, `1` findings, `2` usage/config (a
  command line that did not parse; `--help` stays `0`), and `3` infrastructure (an engine that
  could not run — an unread run is not a dirty one, the report-level twin of the `replayed`
  and `unjudged` census fields). The gate is one pure function, `gateVerdict`, and the human
  text renders its verdict so the report and the exit code can never disagree. The `Gate`
  config's `report.format` also accepts the projections `sarif`, `lsp`, and `codeclimate`.

- cdca144: Judged provenance in the report, and `jig` as the one command with projected output.

  The report now distinguishes what an engine **found** from what it **did**. A diagnostic may
  carry its judged provenance — the entropy `move`, a `score`, a `confidence`, and a proposed
  `repair` with a `complete` flag — and an `EngineSummary` may carry a `status`
  (`ran`/`replayed`/`skipped`/`errored`), an `unjudged` count, and a `drops` breakdown. All
  fields are optional and additive, so a reader of the previous report is unaffected. The
  invariant they serve: "0 findings" and "not looked at" never render the same again.

  `jig check` gains the outward projections `--format sarif | lsp | codeclimate | jsonl`
  (beside the existing `text`, `json`, and `github`), implemented as pure functions of the one
  report and checked against `protocol`'s worked examples. `--limit N` bounds the human
  finding list without ever truncating the census or the ratchet. The human form is now the
  only renderer: `jig check --format text` says what each engine did, marks an unjudged finding
  `(unverified)`, and shows its `move`, `score`, and `repair`. The pi extension and the
  OpenCode plugin are transports over that text rather than re-renderers.

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
