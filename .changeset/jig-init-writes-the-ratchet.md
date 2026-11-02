---
"@autotelic/jig-cli": minor
---

`jig init` now configures the engines it enables, drafts the vocabulary it can decide, and
stops a fresh checkout from running stale code.

From the second adopter run (shakti-v2, tackle @ `fbd0fcf`):

- **joggle gets its correctness flags, not just its name.** `init` writes
  `config: "joggle.config.json"` and `args: ["--types", "--no-replay", "--baseline
  .joggle-baseline.json"]` on a TypeScript repo. A replay is not a look, and an untyped check
  misses the Effect rules; `--typecheck` stays off until joggle's tsgo run reads each
  package's `tsconfig` (it reports ~22k false errors on a real monorepo).
- **The ratchet is born accepted.** When the effective config references an engine ledger and
  the file is absent, `init` writes it once (`joggle check --update-baseline`), reports how many
  findings it accepted, and never rewrites it — same rule as `.jig-baseline.json`. A ledger the
  config does not reference is not written at all.
- **Architecture layers are drafted from the workspace.** `packages/*` and `services/*` become
  `architecture.layers` with `name`/`include` and no `forbid`: the include set is decidable, the
  order and the purity ranges are a person's judgement. Without any block, joggle cannot ask
  "should this import exist" and a repo never sees the 184 findings that question produces.
- **A linked, unbuilt checkout says so.** `bin/jig.js` checks for `dist/` and prints
  `run pnpm build` instead of throwing `ERR_MODULE_NOT_FOUND`; the prompt's checkout line tells
  the agent to build before installing and after changing the CLI.
- **Workspace installs stop failing.** A pnpm workspace root gets `pnpm add -Dw` (the literal
  `pnpm add -D` is `ERR_PNPM_ADDING_TO_ROOT`), and the unpublished-package fallback is keyed on
  "the install failed" rather than on a 404 specifically.
- The gitignored-path report no longer counts `.jig-baseline.json` twice.
