# The render graph, and what it does not claim

A decision record for the response to the mockup spike's feedback
(`shakti-v2/documentation/cutlist-feedback.md`). It records one primitive, the questions it
answers, the measurements behind it, and the asks it deliberately does not build yet.

## The primitive: a resolved edge

The crawler already parsed every JSX element and threw away everything that would let it
answer a question about them. `tags` is a sorted bag of names: `<Link>` (the router's),
`<Card>` (the primitive), and `<StatusStepper>` (a local part) are indistinguishable, and a
multi-root tree has one `Card` per app.

A render edge keeps the two facts that make a name a part:

```ts
{ part: "services/ui/app/components/ProjectProgress.tsx",
  tag: "ProjectProgress", line: 213, count: 1 }
```

Resolution reuses the use-graph's own alias table (`targetOf`), so a tag is an edge only if
the file imports the module the alias names. A namespace binding (`import * as UI`) and an
unresolved name produce **no** edge: a guessed edge is worse than a missing one, because the
reader is a mock author who stops looking once the tool has answered.

One direction is stored. `page -> parts` and `part -> pages` are both projections of the same
list; storing the inverse would double the artifact and give a reader two facts to keep in
step.

## The questions

| question        | query                         | shape                                            |
| --------------- | ----------------------------- | ------------------------------------------------ |
| page -> parts   | `cutlist ask --page <ref>`    | direct children, then parts reached through them |
| part -> pages   | `cutlist ask --part <ref>`    | direct renderers, then the routes that mount it  |
| what resembles? | `cutlist ask --similar <ref>` | name and skeleton evidence, labelled             |
| a sketch        | `cutlist ask --file <path>`   | per declaration, so a proposals file works       |

`ask` reads the committed artifact. The queries are pure functions in `@autotelic/protocol`
(`graph.ts`), so `jig menu --page …` answers identically without importing cutlist, and the
OpenCode/pi surfaces inherit the answer from `jig`.

## Measured on the client tree

`shakti-v2`, 1298 parts, built in ~2.2 s into a temporary output directory:

- `ask --page 'projects_.$id._index'` returns **exactly** the five parts the feedback named
  (`ProductionDates`, `ProgramBadge`, `ProjectProgress`, `SetupProgress`, `SiblingProjects`),
  plus six reached through them — including `SetupTable` and `InputSection`, the existing
  parts behind two of the nine re-inventions.
- `ask --part Button` returns three routes, the direct renderer, and the chain.

### `similar` is not the whole answer, and that is the finding

The feedback claims a name-and-signature query "would have caught all nine". On the
mockups as written, it would not:

| proposed         | expected            | result                                 |
| ---------------- | ------------------- | -------------------------------------- |
| ProgressMeter    | ProjectProgress     | rank 1 (name 0.50)                     |
| TablePanel       | Table               | rank 1 (name 0.50)                     |
| MapCanvas        | ProjectMapboxMap    | rank 1 (name 0.33)                     |
| RateTable        | PerTreeRatesSection | rank 1 is `RateComparisonTable` (0.67) |
| SegmentedTabs    | SegmentedControl    | rank 2, behind `Tabs` (both 0.50)      |
| Toolbar          | FilterBar           | not found — no shared name token       |
| ModalShell       | Dialog              | not found — no shared name token       |
| Field            | InputSection        | not found — no shared name token       |
| FieldworkSummary | SetupProgress       | not found — no shared name token       |

Why: the sketches are hand-drawn markup (`<div>`, `<button>`), so their skeleton shares
almost nothing with the real part; the only remaining signal is the name, and three of the
nine share no name token with the answer. A synonym table (`modal ≈ dialog`,
`field ≈ input`) would close the gap by guesswork exactly where the author cannot check it,
so the query does not have one. `similar` narrows the field and shows its evidence; it does
not decide. `RateComparisonTable` for `RateTable` is a plausible better answer than the one
in the feedback's table, which is the point: the list is for a person.

The `--file` path is the honest way to use a sketch: it parses the file per declaration
(one file, many proposals), and the answer says `name 0.50` rather than pretending structure
spoke.

## What was not built, and why

- **`clientOnly`** (item 4) is a real question with no static answer. The conservative proxy
  is "imports `Transition`/`Portal`, or renders only under a state flag an effect sets", but
  a wrong `false` says "import it" about a part that renders nothing under
  `renderToStaticMarkup` — the expensive mistake the feedback records. The shape it needs is
  a third edge fact (the JSX is effect-gated) from the same parse, plus a `basis` field so
  the tool can say how it knows.
- **Token values, collisions, and the class audit** (items 5-6) need a different model:
  `tokens.ts` reads _keys_ with a brace scan and flattens nesting, so it cannot say whether
  `primary-700` exists. The primitive is a theme object (family -> step -> value, plus CSS
  vars) parsed from the config AST, with the compiled stylesheet as the arbiter: every class
  the audit calls dead must be absent from `build/client/assets/*.css`, every "leaked" step
  must be present with a value the theme does not define. That is a measurement, not a
  heuristic, and it is the next piece.
- **Multiple token sources** (item 7) falls out of that model for free: a theme is a list of
  sources, not a string.
- **`similarTo` in the manifest** (item 8) is refused. The manifest is a per-file lookup for
  lint rules; the similarity join is a judgment about pairs. Freezing it there would make
  every rule carry a stale opinion and grow the file rules parse. The query replaces it.
- **Declared-but-unread keys** (item 9) are left in place for now, and the reason is worth
  recording: `loadConfig` falls back to the whole default config when decoding fails, so
  deleting `patterns.urlState`, `hooks.barrel`, or `tokens.theme` from the schema would turn
  a repo's config into the default one — silently, and with the wrong roots. Dropping them
  safely needs the decoder to _report_ unknown keys first. Reading `hooks.barrel` is the
  other honest option; it would have to change the feature join to mean something, not just
  be consulted.
- **Census determinism** (item 10) is plumb's, not cutlist's. The shape is a fingerprint over
  the sorted finding keys, with `jig check` refusing to compare two runs whose fingerprints
  differ; that belongs with the engine that produced the moving numbers.
