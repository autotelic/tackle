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
- the hook barrel (`hooks.barrel`), read and validated.

## The pipeline

| Pass          | What it does                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1 · Parse     | every module → exports, imports, rendered tags, called hooks, declared props                                                |
| 2 · Use-graph | for each module, the modules that import it                                                                                 |
| 3 · Owners    | an importer's owner is the **first route segment** (`projects_.$id.sponsors` → `projects`), or `shared` under a shared root |
| 4 · Tier      | primitive · ≥2 route owners → shared · 1 → local · 0 → orphan                                                               |
| 5 · Signature | the **behavioral skeleton**, not props ∪ tags                                                                               |
| 6 · Tokens    | closed sets: colors, type, shape, spacing                                                                                   |
| 7 · Emit      | one model, rendered N ways                                                                                                  |

## One model, several renderings

Because every rendering derives from one computed model, they cannot drift from each
other. The load-bearing output is the **lint manifest** — `plumb-ui.config.json` — which
must match the shape `plumb/src/ui/manifest.ts` parses, so lint stays a _lookup_ rather
than a second analysis. `plumb-ui` fails open on a malformed manifest (all rules go
silent), which is why `cutlist check` exists: a stale catalog must be loud.

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
cutlist build --check    # fail if the committed catalog is stale (like prettier --check)
```

## Where it meets the others

`cutlist` **produces** what `plumb` and `joggle` **consume**. It generates duplicate
_candidates_ deterministically (high recall, low precision); `joggle` decides whether two
candidates are one concept (the judgement — the two-regimes split). Doc §9.5's "do not
merge" holds: cutlist is not a rule engine, and the patterns are enforced by rules, not
catalogued by cutlist.
