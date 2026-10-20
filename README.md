# tackle

One pnpm workspace over four independent conformance tools, and the leaf protocol
they agree on.

The cohesion is not that the programs were merged. It is **one config, one report
shape, one baseline, one agent document** — the four seams — over engines that are
each useful alone. That is the Vite+/VoidZero move: keep the engines separate, ship
one surface, make onboarding a prompt.

## The pieces

| Package               | What it is                                                                                                                                                                                          | Runs alone as                          | Consumes                                | Emits                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@autotelic/plumb`    | Single-file Oxlint rules (core / effect / react / ui / meta)                                                                                                                                        | `oxlint` (a `jsPlugin`)                | `.oxlintrc.json`                        | lint diagnostics                                                                                     |
| `@autotelic/joggle`   | Cross-file _judged_ rules                                                                                                                                                                           | `joggle check` (CLI, pi extension)     | `joggle.config.json`                    | verdicts, report, cache                                                                              |
| `@autotelic/cutlist`  | The vocabulary: crawl → tokens + components + tiers + owners + duplicate _candidates_                                                                                                               | `cutlist build`                        | `cutlist.config.json`                   | `catalog.json`, `menu.json`, `MENU.md`, `plumb-ui.config.json`, `diagrams/`, `hooks.md`, `tokens.md` |
| `@autotelic/jig-cli`  | The surface over engines (command: `jig`)                                                                                                                                                           | `jig init/check/explain/learn/promote` | `jig.config.json` (+ each engine's own) | one oxlint-shaped report                                                                             |
| `@autotelic/protocol` | **Not a tool.** The record formats — the named, versioned lexicons (`report`, `baseline`, `catalog`, `manifest`, `menu`, `onboarding`, the configs) — as pure types, JSON Schema, and pure decoders | —                                      | —                                       | JSON Schema, lexicons, fixtures                                                                      |

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

This repo dogfoods both surfaces. `.pi/settings.json` installs the `jig-cli` package into
pi project-locally, and `.opencode/plugins/jig.ts` re-exports the OpenCode plugin, so a
session in `tackle` — human or agent — runs the same `jig check` the shell does.

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
pnpm jig check    # every engine against this repo; holds the ratchet
pnpm jig explain plumb/no-raw-html-layout  # one rule, everywhere it fires, with the fix
pnpm jig promote                           # the ratchet's next rung (--write to drop it)
pnpm jig learn                             # rewrite JIG.md from the rules this repo accepts
pnpm cutlist --help
pnpm jig --help
```

`explain`, `promote`, and `learn` are the read-only answers around the one report. `explain
<engine/ruleId>` expands a rule's findings in this repo — message, `help`, `docsUrl`, and any
`repair` — so `help` is a fix rather than a restatement. `promote` shows the ratchet's next
rung, the accepted identities a run no longer earns, and `--write` drops exactly those: it
only ever shrinks the ledger, because accepting a finding stays a human decision (`jig
baseline`). `learn` rewrites the agent cookbook (`agent.cookbook`, default `JIG.md`) from the
rules the repo already accepts, and `jig init` also writes the onboarding prompt
(`agent.onboarding`, default `ONBOARD.md`).

`pnpm jig check` is the root dogfood gate: it runs `plumb`, `joggle`, and `cutlist` against
this repository, one report, and fails on anything new. What it finds is frozen by identity
in `.jig-baseline.json`; the ratchet only shrinks that file, and Phase B drives every `plumb`
and `joggle` rule to `error` until it is empty.

The `joggle` engine is asked for tsgo's own diagnostics (`--typecheck`), so the one report
carries type errors beside the conformance findings — the same sentence, from the same
command, whether a person, a pipeline, or an agent reads it. `--types`, the declaration trace
the judged rules read, stays opt-in: it typechecks the whole program and only changes an answer
when a judgement is going to be made.

`pnpm judged` is the same run with joggle's key in the environment
(`doppler run -p joggle -c dev -- pnpm jig check`). With the key, every candidate is judged and
the census says so; without it, joggle replays the verdicts committed under `.joggle/answers/`
and the report marks the engine `replayed`. The two runs can never be mistaken for each other —
that difference is the whole point of the census.

`jig check` exits with a code a CI can branch on, the same contract whether a person, a
pipeline, or an agent triggered the run:

| code | meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | clean — the gate passed                                                       |
| `1`  | findings — the gate failed on findings                                        |
| `2`  | usage/config — the command line did not parse                                 |
| `3`  | infrastructure — an engine could not run; the report is incomplete, not clean |

Which findings fail is the repo's own config, read by the gate and nowhere else:

- `gate.failOn` — `error` (any error), `warn` (any error or warning), or `any-new` (the
  default: any finding not already in the baseline).
- `gate.mode` — `all` (the default), or `touched-files`, which gates only on findings in
  files the working tree touches. When git cannot say, the scope widens to `all`; it never
  narrows to an empty set, which would pass everything.
- `report.maxWarnings` — a second, severity-blind regime: more than this many warnings fail
  whatever `failOn` says (`-1` disables it).
- `report.format` — the default for `--format` when the flag is absent.

Infrastructure outranks findings: an engine that could not run exits `3`, so an unread run
never reads as a merely dirty one — the same invariant the report's census keeps with
`replayed` and `unjudged`.

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
now land: `joggle.config.json` declares the dependency law as architecture layers,
`tsconfig.json` gives `joggle` one project to read at the root, `oxlint.config.ts` wires
`plumb` in (at `warn` until Phase B ratchets each rule to `error`), and `jig.config.json` runs
all three engines. [`MIGRATION.md`](./MIGRATION.md) step 6 records what is still open.

## Status

- `protocol` — the record formats as named, versioned lexicons: types, JSON Schema, pure
  decoders, fixtures, a compatibility linter. **Built.**
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
