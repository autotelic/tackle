# @autotelic/cutlist

**The vocabulary.** A deterministic generator: it crawls a UI codebase and emits one
model — the parts inventory — then renders that model several ways. No LLM. Same tree
in, same bytes out.

A cutlist is the carpenter's enumerated parts _with their dimensions_, produced before
you assemble. The metaphor is honest about the important thing: a cutlist is **derived
from the project**, not a fixed catalog. That is why it is generated from the tree
instead of hand-maintained.

## What it reads

Only what `cutlist.config.json` declares — never shakti's paths hardcoded:

- the source tree under `roots` (parsed with the same `oxc-parser` pass joggle uses);
- the import graph (who imports whom, resolved through the configured `alias`);
- the token source (`tokens.from` + optional `tokens.vars`);
- the hook barrel (`hooks.barrel`) — declared in the config schema, but the hook list is
  discovered from the tree; the barrel is not read yet.

## The pipeline

| Pass          | What it does                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · Parse     | every module → exports, imports, rendered tags, called hooks, declared props                                                                                                 |
| 2 · Use-graph | for each module, the modules that import it                                                                                                                                  |
| 3 · Owners    | an importer's owner is the **first route segment** (`projects_.$id.sponsors` → `projects`), or `shared` under a shared root; `transitive` follows the importers of importers |
| 4 · Tier      | primitive root → primitive; ≥2 route owners → shared; 1 → local; no route owners under a shared root → shared; otherwise local. Zero owners is an orphan, counted separately |
| 5 · Signature | the **behavioral skeleton**, not props ∪ tags                                                                                                                                |
| 6 · Tokens    | closed sets: colors, type, shape, spacing                                                                                                                                    |
| 7 · Emit      | one model, rendered N ways                                                                                                                                                   |

## One model, several renderings

Because every rendering derives from one computed model, they cannot drift from each
other. The load-bearing output is the **lint manifest** — `plumb-ui.config.json` — which
must match the shape `plumb/src/ui/manifest.ts` parses, so lint stays a _lookup_ rather
than a second analysis. `plumb-ui` fails open on a malformed manifest (all rules go
silent), which is why `cutlist build --check` exists: a stale catalog must be loud.

The menu is the one **mixed** record: `menu.json` joins the derived composition with
authored intent from `intent/<name>.json`, so regenerating the menu can never overwrite a
sentence a person wrote; `MENU.md` is its cheap text view. Each catalog part also carries a
path-derived `id`, and the join prefers it over the colliding `name`. `diagrams/` renders the same
model as a graph — the composition of each part, the inverse hook view, and ownership —
as Mermaid source beside the SVG `pele` drew from it, drawn at the largest scope that reads
and indexed by a generated table, so the shape a list flattens is visible. `pele` is a
rendering dependency, not a seam: nothing else in the workspace reads it, and it never
touches the model.

## What a part carries

A part is a module, not "a component": roles are read from declarations (`createContext`,
`.Provider`, a `use*` export), so hooks, providers, contexts, barrels, and routes sit in the
same model as components. A default-exported component is a component even when the binding
is declared first and exported later. Routes are entries (`routes/foo.tsx`,
`routes/foo/route.tsx`) while a component under `routes/foo/components/` is owned by that
route but is not one. Each part also carries the public `exports` (including `default`), how
many modules `usedBy` it, its `feature` directory, and a `kind`. Features themselves are a
**query** over those facts — a context plus a provider or barrel — not a classifier with its
own schema. The menu reports the consequences: `sharedReach`/`localOnly` adoption, duplicate
clusters with a canonical survivor, orphans, and authored parts still imported after
retirement.

## Multiple roots

Tiers, routes, and aliases are written once and matched inside each configured source root.
That is what lets one catalog cover a monorepo: `apps/auth/ui/app` and `apps/shop/ui/app` both
have a `components/ui`, a `routes/`, and a `~/*` alias. An alias target is an array because a
`paths` entry is an array; the graph tries each target and prefers the one in the importer's
own root. `ownership.entries` declares the entry points nothing imports by design
(`entry.client.tsx`, `root.tsx`), so they read as routes rather than orphans.

## The signature is the whole point

The proposal this project comes from claimed `Combobox`/`ComboBoxV2` would surface via
`props ∪ tags` at Jaccard ≥ 0.8. Measured against the real files, props overlap is
~0.18 and tags ~0.43 — the metric does not reproduce its own headline example. **Props
are surface area; they are the wrong signature.** Two components that wrap the same
headless primitive and render the same skeleton are the same concept however their
props differ. So cutlist scores the skeleton: wrapped primitive + rendered
sub-components + called hooks.

## Commands

```sh
cutlist build            # crawl, render every output, write them
cutlist build --check    # fail if any committed rendering is stale (like prettier --check)
```

## The artifact (design note)

The model is the truth; the artifact is the model made navigable. [docs/artifact.md](docs/artifact.md)
records the shape it should grow into — one record per part, a stable id, a faceted index,
a composition graph, and separate agent and human renderings — and separates what ships
today from what is proposed. It is a decision record, not a commitment.

[docs/compression.md](docs/compression.md) records how the vocabulary grows and is
collected: a walk allocates freely, the change set is the trigger, duplicates are garbage,
and `joggle` is the marking phase. The menu is a memory, not a fence.

## Where it meets the others

`cutlist` **produces** the catalog, the menu, and the lint manifest. `plumb-ui` reads the
manifest now: `no-deprecated-parts` turns an authored `status: deprecated` plus `useInstead`
into a finding at the import that has not migrated, and fails open when the manifest is
missing or malformed. `joggle` consumes the duplicate candidates deterministically emitted
here and decides whether two candidates are one concept; `jig` runs cutlist's staleness gate
and the other engines through one report. The seam stays the format: neither consumer
imports `cutlist`, and `decodeCatalog` is what a reader uses when it wants the raw model.
