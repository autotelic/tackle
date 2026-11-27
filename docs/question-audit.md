# The question audit

Every rule that can reach the model, and every question it asks. This is rung 3 of
[the remedy hill](./remedy-hill.md): rung 2 split the remedies question into three
atomic judgments and put the decision in code; this audit asks which _other_ rules
are still asking for a fact the workspace already holds.

The unit is the question, not the rule. A question is one `Decision` in a rule's
questionnaire or plan; a rule with no decision is deterministic and asks nothing.
The classification is:

- **fact** — the workspace can answer it from an index, a graph or a schema, with no
  model call.
- **judgment** — the answer genuinely needs the model: intent, acceptable variation,
  or which of two readings a maintainer meant.
- **decision** — code chooses it from earlier answers, a table or the import graph.
  It is a question only because the current shape still sends it.

A judgment is **code-answerable** when a workspace fact already holds the answer,
even though the rule asks the model today. That count, not the raw question count,
is the one this rung exists to expose.

## Totals

| measure                                        |  count |
| ---------------------------------------------- | -----: |
| rules in the run                               |    110 |
| — deterministic plumb rules (Oxlint)           |     59 |
| — adjudicated joggle rule instances            |     51 |
| questions                                      |     86 |
| judgments                                      |     67 |
| decisions                                      |     16 |
| facts                                          |      3 |
| **judgments a workspace fact already answers** | **12** |

The 51 adjudicated instances are the 46 built-in rules plus the five composition
preset rules; the three duplicate rules share one eight-question questionnaire,
which is why the largest single block below is repeated rather than hidden.

## The baseline this generalises

The keyed remedies run is the proof that the split works: of **1,431 pair
judgments**, code decided **1,424** and only **7** needed `j_material`. The lesson
is not "ask fewer questions" but "put the question one layer lower". The table
below asks which of the other 86 questions are still at the wrong layer.

## The five worst offenders

Ranked by how much of the rule's answer the workspace already holds. Each line
names the rule, the judgment, and the fact that would replace it.

1. **`joggle/shallow-module` / `grab_bag`** — replace with: export cohesion and reachability from the import graph.
2. **`joggle/temporal-coupling` / `worth_fixing`** — replace with: the acquire/release pairs and escape paths in the function's control-flow graph.
3. **`joggle/unbounded-default-read` / `verdict`** — replace with: optional filters, call arguments and table growth already in the workspace.
4. **`joggle/inferred-over-recorded` / `verdict`** — replace with: the derived expression and the recorded field read/write sites.
5. **`joggle/underused-primitive` / `does`** — replace with: the export signature and the hand-rolled call shape already indexed.

## Every rule

| rule                                  | questions                                                                                                                                                                                            | classification           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `joggle/layer-direction`              | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/import-cycle`                 | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/layer-purity`                 | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/compose-types`                | `verdict` (judgment)                                                                                                                                                                                 | code-answerable judgment |
| `joggle/call-pattern`                 | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/module-direction`             | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/name-as-address`              | `fails_as_address` (fact) · `address` (judgment)                                                                                                                                                     | code-answerable judgment |
| `joggle/object-shape`                 | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/name-the-primitive`           | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/rule-judgment`                | `decides_in_code` (judgment) · `kind` (decision)                                                                                                                                                     | —                        |
| `joggle/shallow-module`               | `grab_bag` (judgment) · `job` (judgment)                                                                                                                                                             | code-answerable judgment |
| `joggle/temporal-coupling`            | `verdict` (judgment) · `worth_fixing` (judgment)                                                                                                                                                     | code-answerable judgment |
| `joggle/dependency-fit`               | `fit` (judgment)                                                                                                                                                                                     | —                        |
| `joggle/doc-matches-code`             | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/prose-voice`                  | `tell` (judgment)                                                                                                                                                                                    | —                        |
| `joggle/field-type-drift`             | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/hoist-to-domain`              | `duty_family` (judgment) · `home` (judgment) · `duty` (judgment)                                                                                                                                     | —                        |
| `joggle/language-drift`               | `concept` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/duplicate-call-run`           | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/containment`                  | `relation` (judgment)                                                                                                                                                                                | —                        |
| `joggle/duplicate-implementation`     | `redundant` (judgment) · `role` (judgment) · `verdict` (judgment) · `consequence` (judgment) · `canonical` (decision) · `difference` (decision) · `prescription` (decision) · `operation` (decision) | —                        |
| `joggle/duplicate-meaning`            | `redundant` (judgment) · `role` (judgment) · `verdict` (judgment) · `consequence` (judgment) · `canonical` (decision) · `difference` (decision) · `prescription` (decision) · `operation` (decision) | —                        |
| `joggle/naming-drift`                 | `one_concept` (judgment) · `verdict` (judgment) · `operation` (decision)                                                                                                                             | —                        |
| `joggle/reimplemented-primitive`      | `same` (judgment)                                                                                                                                                                                    | —                        |
| `joggle/one-concept-one-type`         | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/structural-collapse`          | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/restated-value`               | `redundant` (judgment) · `role` (judgment) · `verdict` (judgment) · `consequence` (judgment) · `canonical` (decision) · `difference` (decision) · `prescription` (decision) · `operation` (decision) | —                        |
| `joggle/reversal`                     | `expand` (judgment)                                                                                                                                                                                  | —                        |
| `joggle/nullability-drift`            | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/data-error-as-outage`         | `about_a_row` (fact) · `verdict` (judgment)                                                                                                                                                          | —                        |
| `joggle/types-over-logic`             | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/single-path`                  | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/unaccounted-drop`             | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/generic-carries-a-caller`     | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/schema-excludes-domain-value` | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/meaning-switched-by-flag`     | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/unbounded-default-read`       | `verdict` (judgment)                                                                                                                                                                                 | code-answerable judgment |
| `joggle/inferred-over-recorded`       | `verdict` (judgment)                                                                                                                                                                                 | code-answerable judgment |
| `joggle/fact-or-derivation`           | `verdict` (judgment)                                                                                                                                                                                 | code-answerable judgment |
| `joggle/declared-staleness`           | `verdict` (judgment) · `undeclared` (fact)                                                                                                                                                           | —                        |
| `joggle/append-only-honoured`         | `verdict` (judgment)                                                                                                                                                                                 | code-answerable judgment |
| `joggle/deviation-has-a-shape`        | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/table-invariants`             | `drift` (judgment)                                                                                                                                                                                   | code-answerable judgment |
| `joggle/invariant-has-a-reconciler`   | `verdict` (judgment)                                                                                                                                                                                 | code-answerable judgment |
| `joggle/intent-drift`                 | `verdict` (judgment)                                                                                                                                                                                 | code-answerable judgment |
| `joggle/underused-primitive`          | `does` (judgment) · `disposition` (decision)                                                                                                                                                         | code-answerable judgment |
| `joggle/bundle-dot-notation`          | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/bundle-tripartite-value`      | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/bundle-one-file-per-block`    | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/bundle-context-hook`          | `verdict` (judgment)                                                                                                                                                                                 | —                        |
| `joggle/page-needs-composition`       | `role` (judgment) · `verdict` (judgment) · `primary_gap` (decision) · `worth_fixing` (judgment)                                                                                                      | —                        |

## What the audit says to do next

The three facts are already answered without a model and should become code on
their next touch. The sixteen decisions are the cheapest move: each one is already
chosen in code after its answers arrive, so the question is a transport cost. The
twelve code-answerable judgments are the real target — each has a fact named above
that the rule already computes or could compute from the same workspace index.

The remaining 55 judgments are the ones to keep. They ask about intent, acceptable
variation, or a meaning the tree does not carry, and replacing them with a
threshold would move the guess rather than remove it.

## Machine-readable audit

```json
{
  "rules": 51,
  "questions": 86,
  "totals": {
    "fact": 3,
    "judgment": 67,
    "decision": 16
  },
  "codeAnswerable": 12,
  "perRule": {
    "layer-direction": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "import-cycle": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "layer-purity": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "compose-types": [
      {
        "question": "verdict",
        "kind": "judgment",
        "replacedBy": "the structural relation (field set plus added fields) already in the type graph"
      }
    ],
    "call-pattern": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "module-direction": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "name-as-address": [
      {
        "question": "fails_as_address",
        "kind": "fact"
      },
      {
        "question": "address",
        "kind": "judgment",
        "replacedBy": "the call-site fan-out and word shape the rule already computes"
      }
    ],
    "object-shape": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "name-the-primitive": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "rule-judgment": [
      {
        "question": "decides_in_code",
        "kind": "judgment"
      },
      {
        "question": "kind",
        "kind": "decision"
      }
    ],
    "shallow-module": [
      {
        "question": "grab_bag",
        "kind": "judgment",
        "replacedBy": "export cohesion and reachability from the import graph"
      },
      {
        "question": "job",
        "kind": "judgment"
      }
    ],
    "temporal-coupling": [
      {
        "question": "verdict",
        "kind": "judgment"
      },
      {
        "question": "worth_fixing",
        "kind": "judgment",
        "replacedBy": "the acquire/release pairs and escape paths in the function's control-flow graph"
      }
    ],
    "dependency-fit": [
      {
        "question": "fit",
        "kind": "judgment"
      }
    ],
    "doc-matches-code": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "prose-voice": [
      {
        "question": "tell",
        "kind": "judgment"
      }
    ],
    "field-type-drift": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "hoist-to-domain": [
      {
        "question": "duty_family",
        "kind": "judgment"
      },
      {
        "question": "home",
        "kind": "judgment"
      },
      {
        "question": "duty",
        "kind": "judgment"
      }
    ],
    "language-drift": [
      {
        "question": "concept",
        "kind": "judgment"
      }
    ],
    "duplicate-call-run": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "containment": [
      {
        "question": "relation",
        "kind": "judgment"
      }
    ],
    "duplicate-implementation": [
      {
        "question": "redundant",
        "kind": "judgment"
      },
      {
        "question": "role",
        "kind": "judgment"
      },
      {
        "question": "verdict",
        "kind": "judgment"
      },
      {
        "question": "consequence",
        "kind": "judgment"
      },
      {
        "question": "canonical",
        "kind": "decision"
      },
      {
        "question": "difference",
        "kind": "decision"
      },
      {
        "question": "prescription",
        "kind": "decision"
      },
      {
        "question": "operation",
        "kind": "decision"
      }
    ],
    "duplicate-meaning": [
      {
        "question": "redundant",
        "kind": "judgment"
      },
      {
        "question": "role",
        "kind": "judgment"
      },
      {
        "question": "verdict",
        "kind": "judgment"
      },
      {
        "question": "consequence",
        "kind": "judgment"
      },
      {
        "question": "canonical",
        "kind": "decision"
      },
      {
        "question": "difference",
        "kind": "decision"
      },
      {
        "question": "prescription",
        "kind": "decision"
      },
      {
        "question": "operation",
        "kind": "decision"
      }
    ],
    "naming-drift": [
      {
        "question": "one_concept",
        "kind": "judgment"
      },
      {
        "question": "verdict",
        "kind": "judgment"
      },
      {
        "question": "operation",
        "kind": "decision"
      }
    ],
    "reimplemented-primitive": [
      {
        "question": "same",
        "kind": "judgment"
      }
    ],
    "one-concept-one-type": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "structural-collapse": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "restated-value": [
      {
        "question": "redundant",
        "kind": "judgment"
      },
      {
        "question": "role",
        "kind": "judgment"
      },
      {
        "question": "verdict",
        "kind": "judgment"
      },
      {
        "question": "consequence",
        "kind": "judgment"
      },
      {
        "question": "canonical",
        "kind": "decision"
      },
      {
        "question": "difference",
        "kind": "decision"
      },
      {
        "question": "prescription",
        "kind": "decision"
      },
      {
        "question": "operation",
        "kind": "decision"
      }
    ],
    "reversal": [
      {
        "question": "expand",
        "kind": "judgment"
      }
    ],
    "nullability-drift": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "data-error-as-outage": [
      {
        "question": "about_a_row",
        "kind": "fact"
      },
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "types-over-logic": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "single-path": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "unaccounted-drop": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "generic-carries-a-caller": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "schema-excludes-domain-value": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "meaning-switched-by-flag": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "unbounded-default-read": [
      {
        "question": "verdict",
        "kind": "judgment",
        "replacedBy": "optional filters, call arguments and table growth already in the workspace"
      }
    ],
    "inferred-over-recorded": [
      {
        "question": "verdict",
        "kind": "judgment",
        "replacedBy": "the derived expression and the recorded field read/write sites"
      }
    ],
    "fact-or-derivation": [
      {
        "question": "verdict",
        "kind": "judgment",
        "replacedBy": "the append-only declaration and the column writer/readers"
      }
    ],
    "declared-staleness": [
      {
        "question": "verdict",
        "kind": "judgment"
      },
      {
        "question": "undeclared",
        "kind": "fact"
      }
    ],
    "append-only-honoured": [
      {
        "question": "verdict",
        "kind": "judgment",
        "replacedBy": "the migration history and the rewrite method at the call site"
      }
    ],
    "deviation-has-a-shape": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "table-invariants": [
      {
        "question": "drift",
        "kind": "judgment",
        "replacedBy": "the guards on each write path, compared as predicates"
      }
    ],
    "invariant-has-a-reconciler": [
      {
        "question": "verdict",
        "kind": "judgment",
        "replacedBy": "call sites of a reconciler for the same table"
      }
    ],
    "intent-drift": [
      {
        "question": "verdict",
        "kind": "judgment",
        "replacedBy": "the replacement import graph and the deprecated declaration"
      }
    ],
    "underused-primitive": [
      {
        "question": "does",
        "kind": "judgment",
        "replacedBy": "the export signature and the hand-rolled call shape already indexed"
      },
      {
        "question": "disposition",
        "kind": "decision"
      }
    ],
    "bundle-dot-notation": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "bundle-tripartite-value": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "bundle-one-file-per-block": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "bundle-context-hook": [
      {
        "question": "verdict",
        "kind": "judgment"
      }
    ],
    "page-needs-composition": [
      {
        "question": "role",
        "kind": "judgment"
      },
      {
        "question": "verdict",
        "kind": "judgment"
      },
      {
        "question": "primary_gap",
        "kind": "decision"
      },
      {
        "question": "worth_fixing",
        "kind": "judgment"
      }
    ]
  },
  "offenders": [
    {
      "rule": "joggle/shallow-module",
      "judgment": "grab_bag",
      "replacedBy": "export cohesion and reachability from the import graph"
    },
    {
      "rule": "joggle/temporal-coupling",
      "judgment": "worth_fixing",
      "replacedBy": "the acquire/release pairs and escape paths in the function's control-flow graph"
    },
    {
      "rule": "joggle/unbounded-default-read",
      "judgment": "verdict",
      "replacedBy": "optional filters, call arguments and table growth already in the workspace"
    },
    {
      "rule": "joggle/inferred-over-recorded",
      "judgment": "verdict",
      "replacedBy": "the derived expression and the recorded field read/write sites"
    },
    {
      "rule": "joggle/underused-primitive",
      "judgment": "does",
      "replacedBy": "the export signature and the hand-rolled call shape already indexed"
    }
  ]
}
```
