# Bringing `plumb` and `joggle` into `tackle`

`@autotelic/plumb` and `@autotelic/joggle` already exist as separate repositories
(`../plumb` and `../mess`). Their published versions must keep lining up, so they are
moved **with history and tags intact**, not copied.

This is deliberately not done automatically. It rewrites package layout in two live
repositories and changes every internal path. Do it as one reviewed step, on a branch, when
the workspace's greenfield packages (`protocol`, `cutlist`, `jig-cli`) build.

`tackle/` is a git repository now (`autotelic/tackle`, default branch `main`), so step zero
is done.

**The move is done**, on branch `migrate/plumb-joggle`. Both packages came in with
`git subtree add` from a **commit**, which is why the sources' working state did not ride
along:

- **`packages/plumb` ← `plumb/main`** (`951fcd4`, 8 commits past the `v0.6.0` tag — what npm
  has, plus a little). Deliberately **not** `feat/plumb-ui-rules`: that branch carries the
  unreleased `plumb-ui` plugin, and this workspace did not take it. One consequence, recorded
  here so it is not mistaken for a bug: nothing can resolve `@autotelic/plumb/ui`, so
  `examples/self/.oxlintrc.json` — which names it — cannot be built. That is one of the two
  reasons `pnpm lint` ignores `examples/**`, and it holds until the ui branch is imported or
  the exemplar stops naming it.
- **`packages/joggle` ← `joggle/main`** (`1db0b12`, the published `0.1.0` line). `../mess`
  still holds an uncommitted feature line (a `presets/structure` preset, `gauge`, ranking
  rules). It was **not** imported and **nothing was deleted there** — that working tree is
  exactly as it was. The `presets/structure` reference in root `joggle.config.json` went with
  it, and `presets/composition` was not adopted in its place: its own header calls it
  somebody's architecture, opted into rather than defaulted on.
- Both packages' own `.github/` trees and their nested `pnpm-lock.yaml` files are gone — the
  first because "who publishes" must have one answer, the second because a workspace has one
  lockfile and these were the stale ones.

What remains is the checklist below.

## Target

```
../plumb  →  packages/plumb
../mess   →  packages/joggle
```

Leave `../jig` (an unrelated e-commerce monorepo) and `../shakti-v2` (the first
client) where they are.

## Where the two repos stand today

Surveyed before writing this list, because the reconciliation is entirely about the drift
between them and this workspace:

|                   | `../plumb`                      | `../mess` (joggle)              | `tackle` wants              |
| ----------------- | ------------------------------- | ------------------------------- | --------------------------- |
| Working tree      | clean                           | **dirty (uncommitted changes)** | —                           |
| Tags              | `v0.2.4` … `v0.6.0`             | **none**                        | push plumb's once           |
| Published         | `@autotelic/plumb@0.6.0`        | `@autotelic/joggle@0.1.0`       | keep both names             |
| Compiler          | `tsc` 5.9.3                     | `tsgo` (`@effect/tsgo` 0.46.1)  | `tsgo` 0.53.3               |
| Effect            | —                               | `4.0.0-rc.116`                  | `4.0.5` (stable)            |
| `@oxlint/plugins` | `1.79.0`                        | —                               | must track oxlint           |
| oxlint            | `1.79.0`                        | `1.83.0`                        | `1.88.0`                    |
| Formatter         | none                            | none                            | `oxfmt`                     |
| Changesets        | **none**                        | **none**                        | joins tackle's graph        |
| Release workflow  | `.github/workflows/publish.yml` | `.github/workflows/joggle.yml`  | **retired** → `release.yml` |

The `mess` tree was dirty when this list was written, and it still is — that is now the
decision rather than a blocker: `git subtree add` imports a **commit**, so `main` came in and
the uncommitted line stayed behind (see above). Its `devDependencies` pinned
**`@autotelic/plumb@0.6.0`** — the literal that is the cross-repo version alignment this whole
move exists to delete. It is now `"workspace:*"`.

## `git subtree` (keeps history, simplest)

From the `tackle` repository root, with plumb and joggle added as remotes once. This is
exactly what was run, on `migrate/plumb-joggle`:

```sh
git remote add plumb  ../plumb
git remote add joggle ../mess
git fetch plumb  --tags
git fetch joggle --tags

git subtree add --prefix=packages/plumb  plumb  main
git subtree add --prefix=packages/joggle joggle main
```

Leaving `--squash` off is what keeps the history: every commit on both sides becomes an
ancestor of the two merge commits — 464 commits in the repository now, up from 3. (An earlier
draft of this file wrote `--squash=false`; `--squash` is a bare flag and the default is
already "do not squash", so the flag is simply left off.)

## `git filter-repo` (if subtree fights you)

```sh
git filter-repo --to-subdirectory-filter packages/plumb  # run inside a clone of plumb
git filter-repo --to-subdirectory-filter packages/joggle # run inside a clone of mess
```

Then merge the two rewritten histories into `tackle` with `git merge --allow-unrelated-histories`.

## Tags: what rides along, and what doesn't

`git fetch <remote> --tags` is what actually brings `v0.2.4` … `v0.6.0` into tackle's
object store — a subtree merge does not carry tags by itself. Push them once
(`git push origin --tags`); joggle has none, so there is nothing to carry for it.

These legacy `v*` tags are **history, not the release mechanism**. From the first release
onward, `changesets/action` tags each publish with the package-scoped form
(`@autotelic/plumb@0.6.1`, `@autotelic/joggle@0.1.1`), so the two schemes never collide.
Changesets reads the next version from `package.json`, not from tags, so continuity is
automatic as long as nobody hand-edits `version`.

## Their workflows must not survive the move

`packages/plumb/.github/` and `packages/joggle/.github/` come along as ordinary
subdirectories. GitHub only reads the **root** `.github/workflows/`, so `publish.yml` and
`joggle.yml` are already inert — but delete both trees in the move commit, so "who
publishes" has exactly one answer: `tackle/.github/workflows/release.yml`.

## The release graph afterward

Neither repo has a `.changeset/`, and neither is listed in `tackle`'s
`.changeset/config.json` `ignore`, so both simply **join the graph**. The cross-repo pin
becomes a workspace link:

```
"@autotelic/plumb": "0.6.0"   →   "workspace:*"
```

With `updateInternalDependencies: "patch"`, a `plumb` release automatically patch-bumps
`joggle` and republishes it — the by-hand alignment across two repos becomes the same
mechanism that already links `protocol` → `cutlist` → `jig-cli`. Independent versioning
still holds; nothing is forced into lockstep.

Consumers see **zero change**: same npm names, same `bin`, same `exports`, same `pi`.

## After the move — the reconciliation checklist

1. **Rename, then rehome.** ✅ **Done in the move.** `repository.url` on both packages is
   `github.com/autotelic/tackle` with a `directory` field (`packages/plumb`,
   `packages/joggle`), and both dropped their own `packageManager` in favour of the
   workspace's. `joggle`'s `homepage` and `bugs` were repointed too: they named the old repo,
   and a bug filed there would not be read.
2. **Repoint dependencies at the catalog.** **Deferred, on purpose** — the move's diff stays
   about the move. Both packages still carry their own literal versions, so the workspace
   installs three oxlint versions (1.88.0 at the root, 1.83.0 under `joggle`, 1.79.0 under
   `plumb`) and runs two `prepare` patches; they target different store paths and coexist, but
   that is the debt. Paying it means replacing every literal version of `effect`, `@effect/*`,
   `@effect/ai-typesafe`, `@effect/tsgo`, `@typescript/native-preview`, `@oxlint/plugins`,
   `oxc-parser`, `oxlint`, `oxlint-tsgolint`, `oxfmt`, `vitest`, and `@types/node` with
   `"catalog:"` — which means bumping `plumb`'s `@oxlint/plugins` in lockstep with oxlint
   `1.88.0` and taking `joggle` off the rc line (unknown #1). `plumb`'s `typescript` literal
   goes with item 3.
3. **Unify the compiler.** Switch `plumb` from `tsc` to the workspace's `tsgo`, drop its
   literal `typescript`, and adopt `.oxfmtrc.json`. `joggle` is already on `tsgo`.
   **Deferred**, and the formatter half is bigger than it sounds: `plumb` is written in tabs
   and semicolons, so the house style is a **113-file, ~7.8k-line** conversion — a style
   decision about somebody's code, not a tidy-up — and `joggle` is another 65 files. Until it
   is made, both package trees are listed in `.oxfmtrc.json`'s `ignorePatterns`. Also note
   that neither package extends root `tsconfig.base.json` yet: both are self-contained
   compiler configs, which is the same item.
4. **Point `plumb` at `protocol` for the catalog format.** **Not started, and blocked on the
   ui branch** — `plumb/src/ui/manifest.ts` does not exist on the `main` that was imported
   (`src/` has `configs effect index.ts meta react rules shared testing`, and `exports` has
   `./configs` but no `./ui`). When it lands: it defines `UiManifest` by hand and decodes it
   defensively — keep the defensive reader (a lint run must never crash on a stale catalog),
   but take the _type_ from `@autotelic/protocol`.
5. **Retire the duplicate CLI surface.** ✅ **Nothing to do.** `joggle` stayed a first-class
   binary through the move, and `jig` calls it; `plumb` has no CLI of its own (its host is
   `oxlint`), so there was no second surface to fold in.
6. **Dogfood — and it is three separate prerequisites, not one.** Pointing the tools at this
   workspace today (`pnpm jig engines`, `pnpm jig check`) says exactly what is missing. Each
   gap is small and already known:

   **Landed in Round 1 (2026-10-16).** All three prerequisites are in. A root `tsconfig.json`
   scoped to `packages/*/src`, plus `@types/node` in the root `package.json`; a root
   `oxlint.config.ts` threaded with the `plumb`/`plumb-effect` plugins; and a root
   `jig.config.json` running all three engines. `jig` also gained `EngineRef.args` and resolves
   an engine from the project's own `node_modules/.bin` before PATH (so the census reports what
   the project installed, not what a global shell shadows). The root `pnpm jig check` now runs
   `plumb` (461 findings), `joggle`, and `cutlist`, and its 149 identities are frozen in
   `.jig-baseline.json`. The `plumb` rules run at `warn`; Phase B ratchets them to `error`, rule
   by rule, under the ≤50-findings entry bar. Still open in this item: `plumb`'s rules are not
   carried into a root `options.typeAware` config, so `packages/joggle/oxlint.config.ts` stays
   nested and `pnpm lint` keeps `--ignore-pattern 'packages/joggle/**'`; and the exemplar's own
   `plumb` engine still cannot load `@autotelic/plumb/ui`, so `examples/self` has no baseline.

   - **`joggle` has no project to read.** It discovers files through `tsgo`, and the workspace
     has `tsconfig.base.json` and no root `tsconfig.json`. With no project it synthesizes
     TypeScript's default file list (`tsc app.ts util.ts`) and dies on the missing file, which
     `jig` reports as `joggle/unparsed-output` — correct, but it means the engine never looked.
     A root project is two changes, because `tsconfig.base.json` sets `types: ["node"]`:
     a root `tsconfig.json` scoped to `packages/*/src`, and `@types/node` in the **root**
     `package.json` (per-package checks resolve it through their own `node_modules`; a root
     project cannot). Verify with `joggle check --format json` before wiring it into `jig`.
   - **`plumb` has no config to ride.** Root `oxlint.config.ts` is deliberately empty: add the
     `jsPlugins` entry and spread `plumbRecommendedRules`. Until then `jig`'s `plumb` engine is
     _bare oxlint wearing plumb's name_, so a real diagnostic would be attributed to a plugin
     that did not run. Keep it out of `jig.config.json` until the plugin loads.
   - **`cutlist` has nothing to crawl.** The workspace ships no UI. The exemplar is
     `examples/self`, which is a _client_ repo with its own `cutlist.config.json` — crawl it in
     place (`pnpm cutlist build --cwd examples/self`), do not add a root `cutlist.config.json`
     pointing at it.

   The architecture law from `README.md` is written in root **`joggle.config.json`** as
   `architecture.layers` over `packages/*` (not in `jig.config.json`, which only lists the
   engines). Once the two prerequisites above hold, `jig.config.json` lists all three engines
   and the law becomes enforced rather than declared.

   Two couplings make that last step fiddly. Both are recorded because they were hit, not
   predicted:

   - **Oxlint builds a directory's config before it applies any ignore.** `examples/self/.oxlintrc.json`
     names `@autotelic/plumb`, `@autotelic/plumb/ui`, and `@shadcn/lint`. The first can now
     resolve, but `ui` is on the branch this workspace did not import and `@shadcn/lint` is an
     external engine, so any root run that reaches `examples/` fails to _build a config_ rather
     than reporting findings — a root config's `ignorePatterns` does not stop it, and neither
     does `.oxlintignore`. Only the CLI flag does, which is why `pnpm lint` passes
     `--ignore-pattern 'examples/**'`. `jig`'s plumb engine needs the same scope, which means
     `EngineRef` needs an `args` field; its args are currently fixed by the id map in
     `engines.ts`.
   - **A nested config cannot carry `options.typeAware`.** The move surfaced this one: with a
     root `oxlint.config.ts` present, oxlint parses `packages/joggle/oxlint.config.ts` as a
     _nested_ config and rejects it — `typeAware` is root-only. So the item above (moving
     `plumb`'s rules into the root config) has to carry `joggle`'s rules with it, into the one
     place that can hold them. Until then `pnpm lint` also passes
     `--ignore-pattern 'packages/plumb/**' --ignore-pattern 'packages/joggle/**'`, and each
     package is still linted from its own directory (`cd packages/plumb && pnpm lint`,
     `cd packages/joggle && pnpm lint` — both clean), which is what the next section is for.
   - **`jig` never reports an engine whose output it could not read as clean** (it emits
     `<id>/unparsed-output`), but a missing _binary_ is a note, not a finding. Running
     `jig check` at the root therefore exits non-zero today — honestly, and for both reasons
     above.

   Also found by the dogfood and still open: **`packages/jig-cli/extensions/jig.ts` imports
   `typebox` at runtime and `jig-cli` declares neither it nor the pi types**
   (`joggle/dependency-fit`). `../mess` declares `typebox` as a devDependency, so mirroring it
   is one catalog pin plus one install — but decide first whether the pi surface wants
   `typebox` as a dependency, a devDependency, or an optional peer alongside `@opencode/plugin`,
   because the extension ships in `files` and a published install would need it at runtime.

   joggle's calibration rules (`compose-types` among them) also fire at `warn`/`info` against
   the workspace. Those are readings, not defects — accept them into the root
   `.jig-baseline.json` at the same time, so the ratchet guards what is fixed without
   re-reporting what was judged. **Re-derive the list rather than trusting it**: the reading
   that produced it came from a build that also carried `port-adapter-balance` and
   `structure-by-domain`, rules that exist only on joggle's unimported line, so two of the
   names this paragraph once listed were never committed joggle's.

7. **Publish.** `changeset` versioning covers every package under `packages/`. `plumb`
   publishes from `packages/plumb`, `joggle` from `packages/joggle`, each under its
   existing name — four publishes, not twelve.

   Publishing is deliberately **off** in `.github/workflows/release.yml`: the workflow
   versions and opens the "version packages" PR, but carries no `publish` input, because
   `changesets/action` publishes any version npm does not have — which, with every package
   still at 0.0.0, means publishing 0.0.0. (It tried exactly that on the first push to
   `main`.) Turning it on is one input plus the version that should first exist:
   `publish: pnpm release`, `registry-url` on the setup-node step, `NPM_TOKEN`, and the
   `package-manager-cache: false` those docs ask for once credentials are in play.

## Wire the checks the root gate would otherwise skip

Root `pnpm check` is only `format:check → typecheck → test → build`. Both moved packages
carry gates that would be silently dropped:

- `plumb`: `check:rule-tests` (`scripts/check-rule-tests.mjs`) and `check:config`
  (`scripts/check-config.mjs`), plus `lint`.
- `joggle`: `lint` (a lint baseline via `scripts/lint-baseline.mjs`) and its own `check`.

Switch CI to run **each package's own `check`** (`pnpm -r run check`) alongside the root
format/build, rather than assuming the four root scripts cover every package. Note
`joggle`'s `prepublishOnly: pnpm check` still fires inside `changeset publish`; it is
harmless (the run just repeats), but it is not the gate — the gate is CI.

## The unknowns (do not hand-wave these)

1. **joggle's `effect@4.0.0-rc.116` → `4.0.5`.** This is the same rc→stable jump already
   made for `cutlist`/`jig-cli` — `effect/unstable/cli` → `effect/cli`,
   `effect/unstable/process` → `effect/process`, `Either` not top-level,
   `Effect.catchAll` → `Effect.match` — but across joggle's entire surface. It also drags
   **`@effect/ai-typesafe@4.0.0-rc.116`**, the one non-Effect dependency still on the rc
   line, which needs its own decision before the bump can land.
2. **`plumb` must be rebuilt before `joggle` consumes it.** joggle runs against plumb's
   published `dist`, not its source; a source change that is not rebuilt is the exact
   stale-artifact failure `cutlist --check` exists to catch elsewhere. Rebuild, bump, then
   verify joggle against the rebuilt plumb.

   This is not hypothetical. The import found `packages/plumb/dist` — 194 files, tracked,
   while plumb's own `.gitignore` says `dist/` — **41 files behind its `src`**, so the
   committed artifact no longer described the rules it claims to ship. The move refreshed it
   (`pnpm build`), which is what that commit is. It will drift again the first time `src`
   changes, because nothing rebuilds it. The fix has item 3's shape: stop committing it, add a
   `prepack` (joggle has one), and give `plumb`'s `exports` the `development → src` condition
   every other package here uses. Verified before choosing to keep it tracked: joggle's own
   `lint` resolves `@autotelic/plumb` through `dist`, so untracking it before that condition
   exists would break `pnpm lint` on a fresh clone.

3. **joggle's `effect@4.0.0-rc.116` is not resolvable from its ranges alone.** The published
   `@effect/platform-node@4.0.0-rc.116` carries a _caret_ on `@effect/platform-node-shared`, so
   a resolve without joggle's (now deleted) nested lockfile floats that one package onto the
   stable line — where it imports `effect/dist/process/ChildProcess.js`, a path rc.116's
   `effect` does not have, and 53 of joggle's 68 test files fail to load. `pnpm-workspace.yaml`
   therefore pins that single edge
   (`"@effect/platform-node@4.0.0-rc.116>@effect/platform-node-shared": "4.0.0-rc.116"`), which
   leaves every 4.0.5 consumer alone. The override comes out with unknown #1 — it is the price
   of holding two Effect lines in one workspace.
