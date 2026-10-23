# Working in tackle

This repo is both the product and the reference implementation: the tools are built
_with_ the tools. Read this before changing a package.

## The one rule

**The seam is a format, not a shared runtime dependency.** `@autotelic/protocol` has
no dependencies and no runtime — types, JSON Schema, and pure functions only. `plumb`,
`joggle`, `cutlist`, and `jig` never import each other. They agree on bytes.

When you are tempted to `import` one tool from another, you want to add a field to a
format in `protocol` instead.

## House style

These packages follow the conventions the tools established in `plumb` and `joggle` — both
now in this workspace:

- **Effect 4** (`effect@4.0.5`, stable), pinned through the pnpm `catalog:` — never a
  caret. `effect/cli` for commands, `effect/process` for subprocesses, `effect/Schema`
  for decoding, `effect/ai` for joggle's judgement model. Note the move: what was
  `effect/unstable/*` in the rc line is now top-level (`effect/cli`, `effect/process`,
  `effect/ai`). Every package is on the stable line now; the rc-era parent-scoped
  `overrides` entry went with joggle's port.
- **Typecheck and build with TypeScript 7's native compiler.** The compiler is the
  `@typescript/native` alias (`npm:typescript@7.0.2`; its binary is `tsc`). The `typescript`
  name is aliased to the TypeScript 6 compatibility package
  (`npm:@typescript/typescript6@^6.0.2`; binary `tsc6`) because typescript-eslint still
  imports the TS 6 API and TypeScript 7 ships no programmatic API. The shared `prepare`
  script runs `effect-tsgo patch --typescript-package @typescript/native --typescript
  --oxlint`, which patches the native compiler and oxlint; `typecheck`/`build` in each
  package shell to `tsc`, and the base `paths` map resolves `@autotelic/protocol` to source.
  `@effect/tsgo` names the compiler and oxlint versions it supports, so bump all three
  together.
- **The Effect language service's rules are on.** Root `oxlint.config.ts` enables
  `effecttsgo/*` with `options.typeAware` (correctness and anti-pattern at `error`, the
  Effect-native and style rules at `warn`), beside plumb's rules, which are severity-split
  by their own `meta.type`. `pnpm check:catalog` fails if any Effect, TypeScript, or Oxc pin
  stops going through the catalog, and `renovate.json` groups their updates.
- **Secrets are the environment; the host owns them.** A judged engine reads its key from
  the environment it was started with; `jig` passes its environment through; both agent
  surfaces inherit it. Do not add a `.env.local` loader to a tool or a `joggle` PATH shim —
  neither is portable and both diverge from the host. CI and fresh checkouts replay the
  committed verdicts instead. [SECRETS.md](./SECRETS.md) has the contract, the launchers, and
  the two hosts' differences.
- **A quiet rule is only clean if it looked.** Read the census (`joggle check --format json`)
  and classify the questions (`joggle calibrate`) before trusting a zero; tune in layers
  (policy → question → candidate → ignore → code) and commit the re-judged answers with the
  change. [TUNING.md](./TUNING.md) is the process; `packages/joggle/docs/calibration.md` is the
  record.
- **Format with `oxfmt`** and lint with `oxlint` (type-aware, via `oxlint-tsgolint`).
  `.oxfmtrc.json` is the house style: no semicolons, double quotes, 100 columns. The two
  imported trees sit in its `ignorePatterns` until their conversion lands (MIGRATION.md
  item 3), so `pnpm format` will not touch `packages/plumb` or `packages/joggle`.
- **Type-strippable TypeScript.** `erasableSyntaxOnly` is on: no `enum`, no
  namespaces, no parameter properties — Node runs the sources directly.
- **`.ts` import extensions**, rewritten to `.js` at build (`rewriteRelativeImportExtensions`).
- **Comments explain _why_, not _what_.** The surrounding code is the _what_. A comment
  earns its place by recording a decision, a constraint, or a thing that was tried and
  failed.
- **Read defensively, write strictly.** Config and caches decode to a sane empty value
  when malformed; output is written in one exact shape. A stale artifact must degrade
  to silence, never to false findings.

## Package anatomy

```
packages/<name>/
├─ package.json          name, exports (development → src, default → dist), bin, pi
├─ tsconfig.json         extends ../../tsconfig.base.json; noEmit
├─ tsconfig.build.json   extends ./tsconfig.json; emits dist/
├─ README.md             what it is, how it is shaped, where it is going
└─ src/
   ├─ cli.ts             effect/cli; thin — parses, then calls core
   └─ …                  the modules; each is one idea
```

`bin/<name>.js` is the installed entry point and runs `dist/`, never `src/` — Node
refuses to strip types under `node_modules`, which is where a published file lives.

`plumb` predates that shape in two ways, both open MIGRATION.md items: its `exports` point at
`dist` only (no `development → src`), and it commits `dist` while its own `.gitignore` says
`dist/`. So a build dirties its tree, and a stale `dist` there is a real defect — it is the
artifact `joggle` consumes — not a formatting nit.

## Before you call it done

```sh
pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

(`pnpm check` runs exactly that.) Add a fixture test for every new rule or renderer. A
generator's output is only as trustworthy as the pair it is checked against (see
`cutlist`'s known `Combobox`/`ComboBoxV2` case).

## Agent surfaces ship with the package

`jig` is pointed at a repo by an agent, so the agent host is a deliverable, not a detail.
Two, and neither re-implements anything:

- `extensions/jig.ts` — the **pi** package (`pi.extensions` in `package.json`). Not
  typechecked by the package: pi strips types itself, and `tsconfig.json` includes `src`
  only.
- `src/opencode.ts`, published as `@autotelic/jig-cli/opencode` — the **OpenCode** plugin.
  `@opencode/plugin` is an optional peer.

Both shell out to the `jig` binary and hand back what a human's terminal shows. Both expose
`check`, `engines`, `menu`, `onboard`, and `init`: `jig_menu` / `jig.menu` returns the cutlist
artifact's stable shape or the parts and recipes that answer a query, `jig_onboard` / `jig.onboard`
returns the setup plan and prompt without writing anything, and `jig_init` / `jig.init` applies that
plan only after a human approves it. If you find yourself rendering a report a second time
in either one, the report belongs in `jig`'s renderers instead.

## The exemplar is a client, not a fixture

`examples/self/` is a small client repo — its own `cutlist.config.json`, its own `src/`,
its generated catalog committed — kept runnable so the tools are exercised against a real
tree. It is a workspace package so the `examples/*` glob resolves and for nothing else:
it declares **no scripts**, so no `pnpm -r run …` can reach it — which matters, because the
exemplar's own `check` would fail here (it names rules from `plumb`, `plumb/ui`, and
`@shadcn/lint`, none of which it depends on) — and it publishes nothing. It does link
`@autotelic/cutlist` and `@autotelic/jig-cli`, so it has its own `node_modules/.bin`.

Two consequences worth knowing before you touch it:

- **`pnpm lint` passes three `--ignore-pattern` flags** — `examples/**`,
  `packages/plumb/**`, `packages/joggle/**` — and names the three seam packages explicitly,
  because a bare `.` silently skipped their nested files. The exemplar's `.oxlintrc.json`
  names `@autotelic/plumb`, `@autotelic/plumb/ui`, and `@shadcn/lint`: `plumb` and its `ui`
  rulebook are both in this workspace now, and `@shadcn/lint` is external. The two packages
  are ignored for a different reason — each carries its own `oxlint.config.ts`, and a
  _nested_ config may not declare `options.typeAware`, so they lint themselves from their own
  directories (`cd packages/joggle && pnpm lint`). In every case oxlint _builds_ a
  directory's config before it applies any ignore — a root config's `ignorePatterns` does not
  stop it, and neither does `.oxlintignore`. Only the command line does. If you add a root
  `oxlint.config.ts` rule, it will not reach any of the three.
- **A stale exemplar catalog is a real failure**, not a formatting nit: regenerate it with
  `pnpm cutlist build --cwd examples/self` in the same change that moves its `src/`. The
  generator owns its bytes: the artifact is in `oxfmt`'s `ignorePatterns`, so `build` is
  idempotent and `pnpm format` must not touch it. Authored intent lives outside the
  generated tree in `examples/self/tools/ui-intent/`, so it stays formatted. The staleness
  gate compares models, so formatting could never disturb it either.
