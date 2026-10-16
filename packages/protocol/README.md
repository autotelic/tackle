# @autotelic/protocol

**Not a tool.** The four seams the conformance tools agree on, as pure TypeScript
types, JSON Schema, and pure helpers. Zero dependencies, no runtime.

The cohesion of `tackle` is not that the programs were merged — it is that they agree
on **bytes**. A `plumb` lint run, a `joggle` verdict, and a `cutlist` catalog meet in
one report, one baseline, and one vocabulary. `plumb`, `joggle`, `cutlist`, and `jig`
never import each other; they import this.

## The four seams

| Module                  | Seam                                                                            | Consumed by                                                               |
| ----------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `report.ts`             | One oxlint-shaped diagnostic stream                                             | every engine writes it; `jig` reads it                                    |
| `baseline.ts`           | The ratchet: findings accepted by identity, never by line                       | every gate                                                                |
| `config.ts`             | `Vocabulary` (the shared config) + `HarnessConfig`                              | `cutlist` reads it; `jig` reads it; `plumb-ui`'s manifest is a projection |
| `catalog.ts` / `doc.ts` | The model `cutlist` computes, its lint projection, and the menu/onboarding docs | `plumb-ui` reads the projection; agents read the docs                     |

## Why a format and not a shared package

A shared _runtime dependency_ couples releases: bump `protocol` and every engine must
re-release together. A shared _format_ does not — the tools agree on JSON and TypeScript
shapes, and each decodes defensively on its own terms. That is what keeps four tools
independently adoptable while still feeling like one product.

`plumb` is the proof: it does not depend on this package. It reads the manifest
defensively (a stale catalog degrades to silence, never to false findings) and its
reader tolerates fields it does not know. Add a field here, and plumb ignores it until
its reader learns it.

## JSON Schema

`schema/*.json` are the language-neutral forms, for non-TypeScript consumers and for
`$schema` autocomplete in a repo's config files:

```
schema/report.json
schema/baseline.json
schema/catalog.json
schema/cutlist.config.json
```

## The identity rule

Everything is keyed by a component's `path` and a finding's `identity`, never a line
number. Code moves constantly; a baseline that reports every edit as a new finding is
a baseline nobody reads.
