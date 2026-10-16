---
"@autotelic/protocol": minor
"@autotelic/cutlist": patch
"@autotelic/jig-cli": patch
---

Records and lexicons, and per-lexicon versions.

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
