# Bringing `plumb` and `joggle` into `tackle`

`@autotelic/plumb` and `@autotelic/joggle` already exist as separate repositories
(`../plumb` and `../mess`). Their published versions must keep lining up, so they are
moved **with history and tags intact**, not copied.

This is deliberately not done automatically. It rewrites package layout in two live
repositories and changes every internal path — and `tackle/` is not yet a git repository,
so step zero is `git init`. Do it as one reviewed step, on a branch, when the workspace's
greenfield packages (`protocol`, `cutlist`, `jig-cli`) build.

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

The `mess` tree is dirty: **commit and push it first**, or the subtree brings a working
state nobody reviewed. Its `devDependencies` also pin **`@autotelic/plumb@0.6.0`** — that
literal is the cross-repo version alignment this whole move exists to delete.

## `git subtree` (keeps history, simplest)

From the `tackle` repository root, with plumb and joggle added as remotes once:

```sh
git remote add plumb  ../plumb
git remote add joggle ../mess
git fetch plumb  --tags
git fetch joggle --tags

git subtree add --prefix=packages/plumb  plumb  main --squash=false
git subtree add --prefix=packages/joggle joggle main --squash=false
```

`--squash=false` keeps every commit as an ancestor of the merge.

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

1. **Rename, then rehome.** `packages/joggle` is `mess`; set `repository.url` on **both**
   packages to `github.com/autotelic/tackle` with a `directory` field
   (`packages/plumb`, `packages/joggle`), and drop each repo's own `packageManager` in
   favour of the workspace's.
2. **Repoint dependencies at the catalog.** Replace every literal version of `effect`,
   `@effect/*`, `@effect/ai-typesafe`, `@effect/tsgo`, `@typescript/native-preview`,
   `@oxlint/plugins`, `oxc-parser`, `oxlint`, `oxlint-tsgolint`, `oxfmt`, `vitest`, and
   `@types/node` with `"catalog:"` so the workspace pins them once. That means bumping
   `plumb`'s `@oxlint/plugins` in lockstep with oxlint `1.88.0`.
3. **Unify the compiler.** Switch `plumb` from `tsc` to the workspace's `tsgo`, drop its
   literal `typescript`, and adopt `.oxfmtrc.json`. `joggle` is already on `tsgo`.
4. **Point `plumb` at `protocol` for the catalog format.** `plumb/src/ui/manifest.ts`
   defines `UiManifest` by hand and decodes it defensively — keep the defensive reader (a
   lint run must never crash on a stale catalog), but take the _type_ from
   `@autotelic/protocol`.
5. **Retire the duplicate CLI surface.** `joggle` stays a first-class binary; `jig` calls
   it. Do not fold `joggle`'s commands into `jig`.
6. **Dogfood — and it is three separate prerequisites, not one.** Pointing the tools at this
   workspace today (`pnpm jig engines`, `pnpm jig check`) says exactly what is missing. Each
   gap is small and already known:

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
     names `@autotelic/plumb`, which this workspace has not moved in, so any root run that
     reaches `examples/` fails to _build a config_ rather than reporting findings — a root
     config's `ignorePatterns` does not stop it, and neither does `.oxlintignore`. Only the CLI
     flag does, which is why `pnpm lint` passes `--ignore-pattern 'examples/**'`. `jig`'s plumb
     engine needs the same scope, which means `EngineRef` needs an `args` field; its args are
     currently fixed by the id map in `engines.ts`.
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

   joggle's calibration rules (`port-adapter-balance`, `structure-by-domain`, `compose-types`)
   also fire at `warn`/`info` against the workspace. Those are readings, not defects — accept
   them into the root `.jig-baseline.json` at the same time, so the ratchet guards what is
   fixed without re-reporting what was judged.

7. **Publish.** `changeset` versioning covers every package under `packages/`. `plumb`
   publishes from `packages/plumb`, `joggle` from `packages/joggle`, each under its
   existing name — four publishes, not twelve.

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

## The two unknowns (do not hand-wave these)

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
