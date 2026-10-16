# tackle

One pnpm workspace over four independent conformance tools, and the leaf protocol
they agree on.

The cohesion is not that the programs were merged. It is **one config, one report
shape, one baseline, one agent document** — the four seams — over engines that are
each useful alone. That is the Vite+/VoidZero move: keep the engines separate, ship
one surface, make onboarding a prompt.

## The pieces

| Package               | What it is                                                                            | Runs alone as                          | Consumes                                | Emits                                                                      |
| --------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| `@autotelic/plumb`    | Single-file Oxlint rules (core / effect / react / ui / meta)                          | `oxlint` (a `jsPlugin`)                | `.oxlintrc.json`                        | lint diagnostics                                                           |
| `@autotelic/joggle`   | Cross-file _judged_ rules                                                             | `joggle check` (CLI, pi extension)     | `joggle.config.json`                    | verdicts, report, cache                                                    |
| `@autotelic/cutlist`  | The vocabulary: crawl → tokens + components + tiers + owners + duplicate _candidates_ | `cutlist build`                        | `cutlist.config.json`                   | `catalog.json`, `plumb-ui.config.json`, `MENU.md`, `hooks.md`, `tokens.md` |
| `@autotelic/jig-cli`  | The surface over engines (command: `jig`)                                             | `jig init/check/explain/learn/promote` | `jig.config.json` (+ each engine's own) | one oxlint-shaped report                                                   |
| `@autotelic/protocol` | **Not a tool.** The four seams as formats: config, report, baseline, catalog/doc      | —                                      | —                                       | JSON Schema                                                                |

`cutlist` _produces_ the vocabulary; `plumb` and `joggle` _consume_ it. `jig` drives
any registered engine — first-party (`plumb`, `joggle`, `cutlist`) or third-party
(`oxlint`, `eslint`, `@shadcn/lint`) — through one config, one report, one baseline,
and one agent door. A repo with only `oxlint` and `@shadcn/lint` can use `jig` without
ever installing `plumb`, `joggle`, or `cutlist`.

## The dependency law

Declared in root `joggle.config.json` as architecture layers, enforced by
`joggle/layer-direction` once the workspace is dogfooded.

```
protocol  ← depends on nothing
plumb     ← protocol             never joggle, cutlist, jig
joggle    ← protocol             never plumb, cutlist, jig
cutlist   ← protocol             never plumb, joggle, jig
jig       ← protocol + drives the other three as processes
```

Two rules make this real rather than aspirational:

1. **The seam is a format, not a shared runtime dep.** `protocol` is pure TypeScript
   types, JSON Schema, and pure helpers — zero dependencies. The tools agree on bytes.
2. **`jig` shells out; it does not link.** It invokes `oxlint`, `joggle check`,
   `cutlist build` as black boxes, so each stays swappable and independently adoptable.

## Layout

```
tackle/
├─ packages/
│  ├─ protocol/   the four seams as types + JSON Schema + pure helpers (leaf)
│  ├─ cutlist/    the crawler + renderers (binary)
│  ├─ jig-cli/    the surface over engines (command: `jig`; binary + pi extension + opencode plugin)
│  ├─ plumb/      moved in from ../plumb (binary-as-plugin; host = oxlint)
│  └─ joggle/     moved in from ../mess (binary)
├─ examples/self/ the exemplar client repo — a runnable config set, not a fixture
├─ .changeset/    independent versioning
└─ pnpm-workspace.yaml  catalog: pins effect/oxlint/oxfmt/tsgo ONCE
```

`jig` reaches agents two ways without owning a second renderer. The pi extension
(`packages/jig-cli/extensions/jig.ts`, declared through `pi.extensions`) adds `jig_check`,
`jig_engines`, and `/jig`; the OpenCode plugin (`@autotelic/jig-cli/opencode`) adds `/jig`
and re-runs the same binary. Both hand the model what a human's terminal shows, because
"the agent gets a different answer than CI" is the failure the whole workspace exists to
prevent. `@opencode/plugin` is an optional peer — nothing else here needs it.

`plumb` and `joggle` were moved in from their own repositories with `git subtree`, history
intact — see [`MIGRATION.md`](./MIGRATION.md) for which refs came in (`plumb/main`,
`joggle/main`, deliberately not the branches carrying unreleased work) and for the
reconciliation that follows the move. All five packages now build and test here, and
`pnpm check` is green across them.

## Toolchain

- **Effect 4.0.5** (stable), pinned exactly through the pnpm catalog.
- **`tsgo`** — the native compiler (`@typescript/native-preview`) with Effect's language
  service (`@effect/tsgo`) patched in by `prepare`. No `tsc`.
- **`oxfmt`** for formatting, **`oxlint`** (type-aware, via `oxlint-tsgolint`) for linting.

## Commands

```sh
pnpm install
pnpm check        # format:check + typecheck + test + build, every package
pnpm cutlist --help
pnpm jig --help
```

`examples/self` is the exemplar client repo: the full config set (`cutlist.config.json`,
`jig.config.json`, `joggle.config.json`, `.oxlintrc.json`), a small `src/` tree, and the
generated catalog committed under `tools/ui-catalog/`. It is a workspace package so the
`examples/*` glob resolves, and for nothing else — it declares **no scripts**, so no
`pnpm -r run …` can reach it, and changesets ignores `examples-*`. It does declare the tools
it points at (`@autotelic/cutlist`, `@autotelic/jig-cli`) as workspace links, so it installs
its own `cutlist` and `jig` bins. Run the tools against it to see them work end to end:

```sh
pnpm cutlist build --cwd examples/self          # regenerate the catalog
pnpm cutlist build --check --cwd examples/self  # the staleness gate
pnpm jig engines --cwd examples/self            # the census: configured, installed, disabled
```

Root-level dogfood configs are the _other_ half of "build the tools with the tools", and they
land with `plumb`/`joggle`: `joggle.config.json` declares the dependency law as architecture
layers, `oxlint.config.ts` is where `plumb` is wired in, and `jig.config.json` follows once
`jig` can read both. [`MIGRATION.md`](./MIGRATION.md) step 6 lists exactly what is missing and
why — including what `jig check` reports at the root today, which is honest but not green.

## Status

- `protocol` — the four seams as types and JSON Schema. **Built.**
- `cutlist` — crawl → owners → tiers → signature → tokens → render. **v0.**
- `jig-cli` — config, engine runner, one report, baseline, agent door, pi + opencode surfaces. **v0.**
- `examples/self` — the exemplar client repo, kept runnable so the tools are exercised against
  a real tree. **Built.**
- `plumb` — moved in from `../plumb@main` (0.6.0 + 8): single-file Oxlint rules
  (core / effect / react / meta), run as a `jsPlugin`. **Here**, with the reconciliation in
  MIGRATION.md still open (catalog pins, `tsgo`, `protocol`, formatter).
- `joggle` — moved in from `../mess@main` (0.1.0): cross-file _judged_ rules, run as
  `joggle check`. **Here**, still on the Effect `rc.116` line until its port lands.
- `@shadcn/lint` — external engine, curried by `jig`; reconciled by ownership, not
  reimplemented.
