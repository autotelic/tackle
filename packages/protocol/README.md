# @autotelic/protocol

**Not a tool.** The record formats the conformance tools agree on, as pure TypeScript
types, JSON Schema, and pure helpers. Zero dependencies, no runtime, no I/O.

The cohesion of `tackle` is not that the programs were merged — it is that they agree
on **bytes**. `plumb`, `joggle`, `cutlist`, and `jig` never import each other; they agree
on a file format. This package is that format.

## The model: records and lexicons

Every artifact that crosses a boundary is a **record** — a JSON document one tool writes
and another reads. Every record has a named, versioned **lexicon**: its contract.

- The **name** is the contract (`report`, `baseline`, `catalog`), not the file that holds
  it. A tool-written record carries its own reference, so a reader with only the bytes — a
  script in another language, a future tool that replaces `plumb` — can tell what it holds:

  ```json
  { "lexicon": { "name": "report", "version": 1 }, "...": "..." }
  ```

- Each lexicon **versions on its own line**. There is no global `PROTOCOL_VERSION`: a
  change to `report` never forces a reader of `baseline` to re-reason.

- **Kind** is who owns the truth, not who writes the file:

  | kind       | meaning                                                        |
  | ---------- | -------------------------------------------------------------- |
  | `authored` | a human or agent writes it; it is the source of truth          |
  | `derived`  | a tool regenerates it; it is never hand-edited                 |
  | `accepted` | derived from a run, then committed as a ratchet (the baseline) |

  Derived data does not belong _inside_ a record any more than a like-count belongs inside
  a post. The baseline stores identities, never lines or counts; a report may carry tallies
  because it is a snapshot, but nothing downstream reads truth out of them.

- **Stable identity.** Everything is keyed by a path or an identity that survives moves —
  never a line, never a host, never a render order. `catalog.hash` and the baseline's
  identity set are the self-certifying parts: where a reader must _verify_, prefer
  content-addressing.

- **Many-to-many.** No format requires another format, and no format requires an app. The
  menu carries the catalog's `hash` but does not need the catalog to be read; `plumb` reads
  the manifest without importing this package; a repo with only `oxlint` can use `jig`
  without installing `cutlist`. That tolerance is the point.

## The lexicons

| name             | owner                | kind     | ver | schema                       | fixtures                   |
| ---------------- | -------------------- | -------- | --- | ---------------------------- | -------------------------- |
| `report`         | `@autotelic/jig-cli` | derived  | 1   | `schema/report.json`         | `fixtures/report/`         |
| `baseline`       | `@autotelic/jig-cli` | accepted | 1   | `schema/baseline.json`       | `fixtures/baseline/`       |
| `catalog`        | `@autotelic/cutlist` | derived  | 1   | `schema/catalog.json`        | `fixtures/catalog/`        |
| `manifest`       | `@autotelic/cutlist` | derived  | 1   | `schema/manifest.json`       | `fixtures/manifest/`       |
| `menu`           | `@autotelic/cutlist` | derived  | 1   | `schema/menu.json`           | `fixtures/menu/`           |
| `intent`         | `@autotelic/cutlist` | authored | 1   | `schema/intent.json`         | `fixtures/intent/`         |
| `patterns`       | `@autotelic/cutlist` | derived  | 1   | `schema/patterns.json`       | `fixtures/patterns/`       |
| `recipes`        | `@autotelic/cutlist` | derived  | 1   | `schema/recipes.json`        | `fixtures/recipes/`        |
| `onboarding`     | `@autotelic/jig-cli` | authored | 1   | `schema/onboarding.json`     | `fixtures/onboarding/`     |
| `cutlist.config` | `@autotelic/cutlist` | authored | 1   | `schema/cutlist.config.json` | `fixtures/cutlist.config/` |
| `jig.config`     | `@autotelic/jig-cli` | authored | 1   | `schema/jig.config.json`     | `fixtures/jig.config/`     |

Authored records name their lexicon by `$schema` (`$schema/*.json` is exported for
autocomplete), or by their path when the format is one file per key: an `intent/<key>.json`
sidecar may omit both. The manifest's reference is optional because its first readers predate
versioning; `cutlist`'s projector always writes it.

`menu` is a **mixed** record: `composedOf`, `orphans`, `duplicates`, and `hash` are derived
and regenerated; `summary`, `status`, and `useInstead` are authored intent. `MENU.md` is the
rendering; this record is the model.

`intent` is the authored sidecar: one file per part, keyed by the part's stable id or name.
It is where the lifecycle (`stable`, `beta`, `experimental`, `deprecated`) and the sentence
that says what a part is for live, beside the generated catalog rather than inside it.

`patterns` and `recipes` are the derived views an agent reads next: the stable shape and the
relations around it, then the import and minimal shape for a composition or load-bearing
part. `jig menu` reads both without importing cutlist; they are records for the same reason
the menu is.

`onboarding` is a **declared** lexicon: its schema and fixtures exist and are checked, but no
engine serializes it yet (`jig` writes a cookbook, not this record). When `jig` adopts it, the
schema does not change.

## The evolution rule, enforced

Once a lexicon is in the wild you may **add an optional field**. You may never change
whether a field is optional, never remove one, and never reinterpret existing bytes. A
breaking change is a **new lexicon name** — `report` → `report.v2` — not a new meaning for
`report`.

The rule is checked, not documented:

- `fixtures/compat/<lexicon>.vN.json` is a **frozen corpus** — one record per lexicon per
  released version, in the bytes that were valid at the time.
- `scripts/lexicon-compat.mjs` validates every frozen record against the **current**
  schema with an independent validator (Ajv, a devDependency — the runtime stays
  dependency-free). A schema change that would reject an old record fails the build. It is
  wired into the root gate (`pnpm lexicon:compat`, part of `pnpm check`).
- `src/compat.ts` adds a best-effort structural pre-check (`schemaBreakingChanges`): newly
  required fields, removed properties, narrowed types, removed enum values, closed
  `additionalProperties`. The corpus is the guarantee; this is the early warning.

The one migration the rule carries forward: a record written before per-lexicon versioning
carries `protocolVersion: "0.1.0"` and no `lexicon`. Every decoder still accepts it, and
`fixtures/*/legacy.json` pins that fact.

## Reading and writing

**Read defensively, write strictly.** Every lexicon has a pure decoder that takes
`unknown` and returns a typed value or `undefined` — never a throw. A malformed or stale
record degrades to silence (a miss, an empty view), never a crash and never a false
finding. Decoders ignore fields they do not know, so a record from a newer tool still
reads; a known field of the wrong type fails the record whole, because a partial read is a
false finding waiting to happen.

```ts
import { decodeCatalog, decodeManifest, decodeReport, parseJson } from "@autotelic/protocol"

const report = decodeReport(parseJson(text)) // Report | undefined
const manifest = decodeManifest(parseJson(text)) // UiManifest; EMPTY_MANIFEST on junk
```

Nothing here does I/O. `parseJson` is the format's one text reader — a malformed document is
a miss, never a throw — and every decoder takes the `unknown` it produced.

## The judges

The TypeScript is not allowed to judge its own output:

- **JSON Schema**, under `schema/`, is the language-neutral form. `pnpm test` validates
  every golden and legacy fixture against it with Ajv — a judge that is not the TypeScript.
- **The conformance matrix** (`src/conformance.test.ts`) checks each real engine output
  against the schema it must satisfy: `jig check` → `report`, `cutlist build` →
  `catalog`/`manifest`/`menu`, and each authored config. Drift no single package's tests
  would catch shows up here.
- **A second, independent reader** (`scripts/read-report.mjs`) reads a report with nothing
  but Node's standard library and no import of this package. If it ever needs the package,
  the format has quietly become an API.
- **Malformed fixtures**: every lexicon has a `malformed.json` that the schema rejects and
  the decoder degrades to silence, and a test for each.

## Leaving the workspace

`report` is projected outward so findings arrive in standard shapes. `protocol` **specifies
those projections; it does not render them** — see [`docs/projections.md`](./docs/projections.md)
for the field-by-field mapping to SARIF 2.1.0, LSP 3.17, and Code Climate, with worked
examples under `fixtures/projections/` checked by `src/projections.test.ts`. The
implementations live in a rendering host (`jig`), which is allowed to render.

The priority is not symmetric: SARIF is the load-bearing interchange, LSP is the editor
contract, and Code Climate is a courtesy. The report is the truth; a projection is a
rendering, and if a target cannot express something, the information is dropped, not bent
back into the report.

## Scoping a run

A run can be narrowed to what a change introduced. The record — a proposed lexicon,
`changeset` — and its two matchers are specified in [`docs/scoping.md`](./docs/scoping.md):
`jig` computes the change set once, and any engine can read it. The **choice** of scope
stays in the tools; only the measurement crosses the boundary. The proposal is not yet a
schema, so the lexicons table above does not list it.

## What must never be in this package

- No runtime dependency, no imports, no `effect`, no I/O, no rendering, no CLI.
- No policy: severity ceilings, gate modes, and ownership rules belong to the tools. This
  package names their vocabulary and nothing more.
- No engine's private need leaked into a shared format. If `plumb` wants a field, it
  teaches its _own_ reader first.
- No line numbers as identity; no ordering as contract beyond a documented total order; no
  behavior beyond pure functions that are genuinely part of the format's semantics.

## Why a format and not a shared package

A shared _runtime dependency_ couples releases: bump `protocol` and every engine must
re-release together. A shared _format_ does not — the tools agree on JSON and TypeScript
shapes, and each decodes defensively on its own terms. That is what keeps four tools
independently adoptable while still feeling like one product.

`plumb` is the proof: it does not depend on this package. It reads the manifest defensively
(a stale catalog degrades to silence, never to false findings) and tolerates fields it does
not know. Add a field here, and plumb ignores it until its reader learns it.
