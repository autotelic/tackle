---
"@autotelic/jig-cli": patch
---

Honor an engine's `config`, and stop repeating an engine's own prefix in a rule id.

`EngineRef.config` was decoded, documented and never used: the root config's
`"config": "oxlint.config.ts"` worked only because oxlint discovers that file anyway. `argsFor`
now passes `--config <path>` for `oxlint-plugin` engines. For the others (cutlist, joggle) the
field stays a pointer, because only oxlint has a flag to put it in.

A rule id that already carried the engine's own prefix was composed with it a second time:
`joggle` reports `joggle/import-cycle`, so the report read `joggle/joggle/import-cycle` — a name
no document uses, that `jig explain joggle/import-cycle` could not find, and that a baseline
would store. `ruleIdOf` now strips the engine's own prefix from a bare code, the same way it
already dropped it from oxlint's `plugin(rule)` form, and `unparsed-output` and `stale-catalog`
are stored unqualified so `${engine}/${ruleId}` composes exactly once.

`engines.test.ts` pins the rule-id case and the unqualified fallbacks, and the root
`jig.config.json` now asks the `joggle` engine for tsgo's diagnostics (`--typecheck`) so type
errors land in the one report.
