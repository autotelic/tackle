# Writing a rule

joggle is a registry, and a registry is only half a plugin system. The other half
is `@autotelic/joggle/plugin`: one entry point exporting everything a rule needs,
so an opinion of your own is a module that imports the package rather than three
relative paths into it. Everything re-exported there is supported; anything not
there is not.

The engine owns traversal, caching, batching and the report. A rule says what to
look for and what to ask; it never walks the AST by hand or makes its own API
call.

## joggle is the judged layer

A linter checks one file; a typechecker checks one program. joggle asks the
cross-file questions neither can: are these two declarations one thing, does this
name mean the same here as there, is this the primitive that already exists.

Every rule is therefore a JUDGED rule: a candidate the deterministic index
produces, and a question Jev answers. `defineRule` with `judged: false` still
exists in the type, and it is a smell -- `unused-import` belongs in oxlint, a type
error belongs in tsc. If a deterministic predicate can decide it, that is where it
goes, and joggle does not need a rule for it. The `require-judged` meta-rule
rejects one.

The deterministic half of a judged rule is its candidate generation (`find`),
which is code and free. The verdict is the model's.

## A judged rule

```ts
import { Decision, Effect, Atoms, verdictOf, qualityOf, outcome, finding } from "@autotelic/joggle/plugin"

export const genericName: PlannedRule = {
  id: "acme/generic-name",
  severity: "info",
  description: "A generic single-word export.",
  judged: true,
  onUnavailable: "report",
  plan: Effect.fn("acme/generic-name")(function* (workspace, scope) {
    const atoms = yield* Atoms
    const planned = []
    for (const unit of workspace.units) {
      if (!unit.exported) continue
      if (scope.changed !== undefined && !inScope(scope, unit.file)) continue
      const id = yield* atoms.add({ name: unit.name, file: unit.file })
      planned.push({
        ruleId: "acme/generic-name",
        subject: unit.name,
        concerns: [unit.file],
        atoms: [id],
        // The same declaration the read uses, so calibration can reduce it too.
        violations: { verdict: ["generic"] },
        decisions: {
          verdict: Decision.classify({
            instructions: "Is `atoms[" + id + "].name` a generic single word?",
            criteria: { generic: "One word with no owner.", specific: "A named thing." },
          }),
        },
        read: (answers) => answers,
      })
    }
    return {
      plans: planned,
      read: (answers) => {
        const verdicts = verdictsOf(answers)
        const diagnostics = []
        planned.forEach((entry, index) => {
          const verdict = verdictOf(verdicts[index]?.verdict, ["generic"])
          if (verdict === undefined || verdict.label !== "generic") return
          const quality = qualityOf({
            score: verdict.probability,
            margin: verdict.margin,
            confidence: verdict.confidence,
          })
          if (quality.quality !== "act") return // flagged, not printed
          diagnostics.push(
            finding({
              ruleId: "acme/generic-name",
              severity: "info",
              message: entry.subject + " is a generic name.",
              location: { file: entry.concerns[0], line: 1, column: 1 },
              judged: true,
            }),
          )
        })
        return outcome(diagnostics)
      },
    }
  }),
}
```

## The facts a rule reads

`Workspace` is the index. Load it with `loadWorkspace(root, paths)`.

| Field | What it is |
| --- | --- |
| `workspace.files` | every parsed `SourceFile`, with `path` and `text` |
| `workspace.units` | functions, interfaces, type aliases, classes, variables |
| `workspace.imports` | the import graph: `edges`, `importersOfName`, cycles, layers |
| `workspace.manifests` | the `package.json` of each directory |
| `workspace.types` | the tsgo type trace (needs `--types`) |

A `SourceFile.facts` carries what the parser found:

| Fact | What it is |
| --- | --- |
| `callSites` | every call, with its span and dotted callee name |
| `jsx` | every JSX element name |
| `objects` | every object literal: keys, span, whether it is a declaration |
| `columns` | columns a knex migration creates, with their nullability |

A `Unit` is one declaration: `kind`, `name`, `file`, `location`, `exported`,
`text`, `tokens`, `typeRefs`, `calls` (resolved to `file#name`), `fields`,
`fieldTypes`, `composed`, `shapeHash`, `callSignature`, `typed`, `test`.

## Test it

`@autotelic/joggle/testing` runs a rule against a fixture, with or without a
model, so a rule is tested the way it runs.

```ts
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { plannedDiagnosticsOf, answeringModel } from "@autotelic/joggle/testing"
import { loadWorkspace } from "@autotelic/joggle/plugin"

const workspace = await Effect.runPromise(
  loadWorkspace("tests/fixtures/acme", ["."]).pipe(Effect.provide(NodeServices.layer)),
)

// Answer the questions yourself.
const outcome = await Effect.runPromise(
  plannedDiagnosticsOf(rule, workspace).pipe(
    Effect.provide(answeringModel({ verdict: { type: "choice", choice: "generic", probabilities: { generic: 0.9 }, confidence: 0.9 } })),
    Effect.provide(NodeServices.layer),
  ),
)
```

## Register it

A repository adds its rules in `joggle.config.json`:

```json
{
  "plugins": ["./tools/joggle/generic-name.ts"]
}
```

A plugin module exports `rules`, and optionally `config` to set severities:

```ts
export const rules = [genericName]
export const config = { rules: { "acme/generic-name": "warn" } }
```

A `preset` is the same thing packaged to share with others:
`"presets": ["@autotelic/joggle/presets/composition"]`.

## The discipline the API is shaped by

- **Deterministic where you can prove, and judge only where you must.** The
  candidate filter is code and free; the verdict is a question.
- **Declare the violation.** `violations` on the plan names the labels that mean
  the rule is violated; `verdictOf` reduces any answer (a Choice's mass on them, a
  Noul's probability) to one number the gate and the report read. Calibration uses
  the same declaration.
- **Band every answer.** `qualityOf` gives `act`, `review` or `drop`, and a band
  is not a reason to discard an answer. `act` is the rule's own severity, `review`
  is a notice, and only a real no is a recorded drop. Discarding the model's
  unsure answers throws away the one signal that says a reader should look.
- **State is bounded.** Put the panel a reviewer needs in the atom, and no more:
  unrelated detail costs accuracy.
- **Declare the move.** A rule that proposes an entropy reversal says which one:
  `move: "contract" | "combine" | "expand"` (see `docs/thesis.md`). The report
  groups by it and prints the ratchet order. Leave it off for a rule that checks
  the code against a requirement instead.

## The fence

Those lines are not advice. `@autotelic/joggle/plugin` exports `metaFindings`,
the authorship rules every rule module here must keep, and a test enforces them:

- `require-judged` -- every rule is judged. A deterministic rule is a linter or
  typechecker job, not a joggle question.
- `require-violations` -- a planned rule declares the labels that mean it is
  violated, or calibration cannot reduce its question.
- `require-test` -- a test names the rule or a symbol it exports.
- `bounded-atoms` -- no atom carries a whole file; a bounded sample instead.
- `band-the-answer` -- a judged rule reads a judgement's quality with `qualityOf`
  and does something with each band.

A rule can opt out of one with `meta-allow: <rule>` and a stated reason. The
opt-out is explicit and greppable, the way a recorded decision is: an author can
make the exception, but not hide it. Two rules do, each with its reason in the
source -- `dependency-fit`, whose finding is a fact the model only qualifies, and
`module-direction`, whose role classification has no per-module quality to gate
on.
