# The artifact

**Status: design note.** This records the shape `cutlist` should grow into and the
decisions behind it. It is not a spec of what ships today. Sections marked _now_ are
implemented; everything else is a proposal. The point is to keep the shape from being
reinvented by the first renderer that needs it.

## The sentence

`cutlist` computes one model. The artifact is that model made navigable: **one record per
part, one stable id, a faceted index for queries, a composition graph for assembly, and
two renderings — one an agent reads, one a person looks at.**

The static page is a rendering, not the artifact. The binary tree is a view, not the data
structure. The file format is JSON under the `protocol` lexicons; the ambition is in the
**contract**, not a new encoding.

Call the bundle a **plan set**: the parts list, the assembly, and the drawings in one
directory. A plan set is what you hand someone who has to build; it is not the building.

## The layers

Two are sources, one is a join, one is a projection. Only the sources are authoritative.

| Layer         | What it is                                         | Written by        | Rebuilt when        |
| ------------- | -------------------------------------------------- | ----------------- | ------------------- |
| **Model**     | the parts and what they are made of                | the crawler       | the tree moves      |
| **Intent**    | what a part is _for_, and what to use instead      | a person or agent | someone explains it |
| **Menu**      | model + intent, joined                             | `cutlist build`   | either changes      |
| **Rendering** | `MENU.md`, `entries/`, `atlas/`, the lint manifest | projection        | the menu changes    |

`protocol/src/doc.ts` already names the crucial split: composition, orphans, duplicates
and the hash are **derived**; `summary` and `useInstead` are **authored**, and are the
only reason the menu is not merely a rendering. The `menu` lexicon is declared and
fixtured. No engine serializes it yet — `cutlist` renders `MENU.md` directly from the
catalog. The first concrete move is to make the model real: emit `menu.json`, render
`MENU.md` from it, and never let a renderer reach past it.

The intent needs a home of its own. If authored fields live only inside the generated
menu, every rebuild has to merge by hand and a deleted part takes its prose with it. Put
intent in `intent/<id>.json`, keyed by the stable id; `menu.json` is the generated join.
The menu can then be deleted and rebuilt at any time — which is the test of whether
something is derived.

## Two readers, one record set

The agent and the human are not two artifacts. They are two **access patterns** over the
same records. Designing them separately is how they drift.

| Question                  | Agent                                         | Human                         |
| ------------------------- | --------------------------------------------- | ----------------------------- |
| "What exists?"            | `MENU.md` / `menu.json`, one line per part    | the wall, grouped by tier/app |
| "What do I use for this?" | `index/by-*` → candidate ids                  | search and filter             |
| "How do I use it?"        | `entries/<id>.json` → import + export + props | the entry page, with a render |
| "What is it made of?"     | `graph/composes` / `trees/<owner>`            | the composition tree          |
| "Is it consistent?"       | duplicate candidates + `usedBy`               | the app matrix                |
| "What is missing?"        | orphans, undocumented, gaps                   | the gaps page                 |

The agent needs **small, deterministic, addressable** records it can read one at a time.
The human needs **visual, comparative, shareable** pages. The bytes underneath are the
same; only the rendering and the budget differ.

If they must ship as two bundles, cut them from the same records: `agent/` and `atlas/`,
both generated, neither authoritative.

## Why not a tree

The instinct is right — the agent needs a cheap way to dive in — but a tree is the wrong
shape for the inventory:

- **Composition is a DAG.** `Card` is used by many pages; `Button` by many components. A
  tree either duplicates the shared part at every branch or picks one parent, and both are
  lies.
- **Ownership is many-to-many.** A component can be imported by two route owners; that is
  exactly what makes it shared. A tree gives it one home.
- **Agents query sets; they do not walk taxonomies.** "Shared components owned by
  `projects`, not yet used by `sponsors`, whose signature is Button-like" is a facet
  intersection, not a depth-first traversal.
- **A page is a tree; the inventory is not.** One page's composition can be rendered as a
  tree (`trees/<owner>.json`) because it has an entry point and a direction. That tree is
  a derived view, not the storage model.

If the name index grows past a context budget, compress **the index** as a trie — a string
lookup structure, not a semantic hierarchy. The taxonomy stays a graph.

## The artifact on disk

```
tools/ui-catalog/              (configurable; committed)
├─ plan.json                   the manifest: what this is, what it can answer, where to look
├─ catalog.json                the model (now)
├─ menu.json                   the menu: one row per part (proposed)
├─ MENU.md                     the cheap text rendering (now)
├─ hooks.md                    the hook barrel (now)
├─ tokens.md                   the token vocabulary (now)
├─ plumb-ui.config.json        the lint projection (now)
├─ entries/
│  └─ <id>.json                one part, fully described
├─ index/
│  ├─ by-tier.json
│  ├─ by-owner.json
│  ├─ by-app.json              monorepo
│  ├─ by-package.json          monorepo
│  └─ names.json               id lookup; a trie when the list is large
├─ graph/
│  ├─ composes.json            part → parts it renders/calls
│  ├─ used-by.json             part → owners and apps
│  └─ duplicates.json          candidate pairs, with scope
├─ trees/
│  └─ <owner>.json             the composition tree of one page
├─ intent/
│  └─ <id>.json                authored: summary, useInstead, notes
└─ atlas/                      the human rendering (built, deployable)
```

The files are the API. An agent already knows how to `ls`, `grep`, and `cat`; the artifact
does not need a query language, a server, or an MCP tool to be navigable. One part per
file also makes the artifact diffable: a component change is one file, not a 2 MB JSON
diff.

### Progressive disclosure

Each level is roughly an order of magnitude more expensive than the one before. The agent
should stop at the cheapest level that answers the question.

| Level | File                  | Answers                                  | Cost              |
| ----- | --------------------- | ---------------------------------------- | ----------------- |
| 0     | `plan.json`           | is this current, and what can it answer? | ~1 KB             |
| 1     | `MENU.md`/`menu.json` | what exists?                             | one line per part |
| 2     | `index/*.json`        | which ids match this facet?              | ids only          |
| 3     | `entries/<id>.json`   | can I use it, how do I import it?        | one record        |
| 4     | the source            | how does it work?                        | the file          |

`plan.json` carries a `capabilities` list — the questions the artifact can answer without
reading source — so an agent knows when it has enough and when it is guessing.

## The id

Every part gets one stable `id`, derived from its name and disambiguated by app or package
on collision. The id is the address everywhere:

- the filename: `entries/button.json`
- the URL: `/c/button`
- the registry item: `@shakti/button`
- the agent's citation: `button@5aad97ef`
- the lint finding: `button` (never a line number)

The `@hash` form pins the artifact version. A scene or a ticket can cite
`button@5aad97ef`; a later `showroom check` can tell whether the part moved underneath it.
That is the cheapest defence against the showroom rotting.

The id survives the moves that matter: `local → shared` changes the tier and the path, not
the name. That is why intent keys by id and not by path — promotion must not lose the
sentence someone wrote about the part. A rename is a new id; treat it as a delete plus an
add. The duplicate graph will show the pair, which is the honest signal.

## The agent's path

A generated `AGENTS.md` in the artifact states the path, so the agent does not have to
infer it:

1. Read `plan.json`. If its hash is not the one you were given, stop.
2. To build a page, read `index/by-owner.json` for the owner, then `trees/<owner>.json`.
3. To use a part, read `entries/<id>.json`; import from `imports[0]`, render `exports[0]`.
4. If no entry matches, do not invent a part. Record a gap.

The inventory is a **closed world**. If a part is not in the menu, it does not exist for
the purposes of assembly; it is a gap to fill, not something to hallucinate. That is the
contract that makes the menu useful, and the reason the missing-intent flag belongs in
lint rather than in a convention.

### Budget

An artifact an agent cannot afford to read is not an agent artifact. `plan.json` reports
the cost of each level (bytes, and an estimated token count); `MENU.md` is the budgeted
view and must fit a configured budget. If it does not, it groups by owner with counts and
points at `index/` rather than growing without bound. The budget is checked in `--check`,
because a budget that is not enforced is a wish.

### Determinism

The artifact must be byte-identical for the same tree and config, or `--check` is theater.

- No absolute paths. **`catalog.root` is absolute today** — a portability bug to fix
  before the artifact is shared across machines.
- No timestamps, hostnames, or run ids.
- Every array sorted by a stated key; every map emitted in a stated order.
- A hash over the model and a per-file hash in `plan.json`, so a stale `atlas/` is caught,
  not only a stale `catalog.json`.

## The human's path

The atlas is a static site generated from the same records. It is addressable and
shareable because assessment is a social act: someone sends a link to a page, not a JSON
file.

Four views:

- **Wall** — every part, grouped by tier and app, with the authored summary and token
  chips. This is the browse.
- **Entry** — one part: composition, owners, props, tokens, duplicate pairs, source
  excerpt, and the authored intent.
- **Matrix** — the monorepo view that matters. Rows are concepts, columns are apps, cells
  are the variant each app uses. Two Buttons in two apps become one visible row, not two
  search results. The matrix is a **candidate** view — cutlist proposes the clustering,
  `joggle` judges it — and says so.
- **Gaps** — orphans, undocumented parts, unowned parts, duplicate candidates, and
  concepts that exist in only one app.

Two fidelity levels, labeled honestly:

- **Catalog** — metadata and composition. Deterministic, no app runtime, deployable from
  the artifact alone.
- **Rendered** — imports the real components and renders them with fixtures. This is the
  showroom seam; it requires the app's runtime and is not deterministic.

The atlas must never show a render it did not do. A thumbnail that is a placeholder is
fine; a placeholder that looks like a component is a lie.

### The atlas is not the showroom

- The **atlas** is a derived view of what exists.
- The **showroom** is an authored arrangement of what could exist.

They share the entry records and the tokens, and nothing else. Keeping them separate is
what stops scenes from becoming a second vocabulary. A scene may link to the atlas; the
atlas may list scenes; neither may import the other's source.

## The monorepo dimension

The current config assumes one app: one `roots`, one `alias`, one global `tiers`. Shakti is
a monorepo, and that assumption breaks in three places:

1. **Aliases collide.** `@/` means `apps/web/src` in one app and `apps/admin/src` in
   another. A single alias map resolves one and silently mis-resolves the other.
2. **A package primitive has no route owner.** It is not an orphan; it is a library part
   nobody has used yet. The current orphan rule would call it dead.
3. **"Shared" is ambiguous.** Shared across routes in one app, shared across apps, or
   published from a package? Those are different facts and the artifact needs to say
   which.

The proposal: add a `workspace` dimension to the config and to every component.

```json
{
  "workspace": {
    "apps": {
      "web": { "root": "apps/web/src", "alias": { "@/*": ["apps/web/src/*"] } },
      "admin": { "root": "apps/admin/src", "alias": { "@/*": ["apps/admin/src/*"] } }
    },
    "packages": {
      "@shakti/ui": { "root": "packages/ui/src", "tier": "primitive" }
    }
  }
}
```

Each component carries `app`, `package`, and `home`; the facets become `by-app` and
`by-package`; duplicates carry a `scope` (`within-app` or `cross-app`); an orphan means
"no app uses it", with package entry points exempt. The matrix needs this dimension to
exist at all.

This is the largest format change on the list, and the reason to decide it now, while the
artifact is still a document.

## The format work

The encoding is not the ambition. JSON, JSON Schema, and the lexicon rule already exist:
**add an optional field; never remove or reinterpret one; a breaking change is a new
lexicon name.** The ambition is in the contract around the records.

The concrete format work, in order:

1. **Emit `menu.json`.** `protocol/projectMenu` already computes it; `cutlist` should
   serialize it and render `MENU.md` from it. _Now possible; not done._
2. **Add `intent/<id>.json`.** Authored, never overwritten. The menu joins it. This
   replaces the hand-merge inside a "mixed record" with a source that cannot be lost.
3. **Menu v2.** Add `id`, `kind`, `owners`, `app`, `package`, `imports`, `exports`,
   `standalone`, `usedBy`, and resolve `composedOf` to ids. Bump the `menu` lexicon to 2;
   keep v1 fixtures; every new field optional.
4. **`plan.json`.** The artifact manifest: `lexicon`, `hash`, `generator`, `capabilities`,
   `counts`, `paths`, `files` (path + sha256). A new lexicon only if a non-cutlist reader
   depends on it; until then, a documented convention is enough.
5. **Entries, index, graph, trees.** One record per part; facets; edges. These are
   projections, not new truth, so they can be added without touching the model.
6. **The atlas.** A static build from the projections. No new data.
7. **The registry export.** A shadcn-compatible item per part, projected from the same
   entry. Do it after the entry shape is stable; a registry is a distribution format, not
   a second catalog.

## What would make this bad

- A second curated catalog. Then the derived one is a suggestion and the curated one is
  the truth, and they drift.
- Prose in the machine record. `summary` and `useInstead` are the only prose, they are
  authored, and they are optional.
- A tree over the inventory. It will duplicate shared parts or lie about ownership.
- A static page that pretends to be the app. The atlas says which fidelity level it is on.
- A non-deterministic artifact. Then `--check` is theater and the hash is decoration.
- Generating the authored half. A tool that invents "what this is for" is a tool that
  makes the menu untrustworthy.
- Building the showroom before the artifact is right. The showroom consumes the menu; a
  bad menu makes a bad showroom.

## Now, next, later

| When      | What                                                                 | Where                                |
| --------- | -------------------------------------------------------------------- | ------------------------------------ |
| **Now**   | catalog, manifest, `MENU.md`, hooks, tokens                          | `cutlist/src`                        |
| **Next**  | emit `menu.json`; `intent/`; stable id; relative `root`; `plan.json` | `cutlist/src/render`, `protocol/src` |
| **Next**  | `menu` v2 + `workspace`; entries, index, graph, trees                | `protocol/schema`, `cutlist/src`     |
| **Later** | atlas build; registry export; showroom scenes                        | new package / `cutlist` subcommands  |
| **Later** | `jig build` as the one command that produces the artifact            | `jig-cli/src/engines.ts`             |

A note on the command surface: `cutlist build` **produces** the artifact; `jig check`
**verifies** it by running `cutlist build --check`, which writes nothing. If "by way of
jig" should mean one command that produces and reports, that command is `jig build` (or
`jig artifact`), and it is a new mode, not a change to the gate. `jig` owns no analysis;
it would shell out with different args. The producer and the proof stay separate.

## Open questions

- **Id policy.** Name-derived ids survive promotion and path moves but collide across
  apps. Is the disambiguator `app/name`, `package/name`, or a first-seen registry?
- **Artifact root.** Committed `tools/ui-catalog/` (reviewable, `--check`-able) or
  generated `.cutlist/` (clean tree, no diffs)? The current answer is committed; the atlas
  should probably be generated, not committed.
- **Intent ownership.** Does the agent draft `summary`, or only a human? The menu flags
  absence either way; the question is who is allowed to fill it.
- **Scene citations.** Does a scene record `id@hash` for every part it imports? That is the
  cheap drift check, but it makes scenes brittle to intentional changes.
- **One root config or one per package?** One root config with a workspace map keeps one
  artifact for the whole monorepo; per-package configs keep ownership local but make the
  cross-app matrix a join across artifacts.
