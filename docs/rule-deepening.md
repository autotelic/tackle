# Deepening the rules

Written after the remedy hill, from `docs/question-audit.md` (110 rules, 86 questions,
67 judgments, 12 code-answerable) and from what the fact store can now answer cheaply.

## The finding that organises everything

**Thirty-one of the fifty-one adjudicated rules ask exactly one question called `verdict`,**
and most of them ask it with no facts in front of it: _"is this a duplicate, yes or no?"_.
That is a judgment asked to do a decision's job. Deepening a rule is almost always the
same motion: **put facts in front of the verdict, and move the part they settle out of the
question.**

## Four depths, in increasing cost

| depth                 | the move                                                      | example                                                                                                            |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **L1 fact**           | a workspace index answers it; delete the question             | `import-cycle`, `layer-direction`, `dependency-fit` are pure graph facts today and still ask a model               |
| **L2 neighbourhood**  | add who else touches it: callers, exports, document frequency | `name-as-address` needs import fan-out, not a verdict                                                              |
| **L3 history**        | add what changed: the ledger, the previous run, the delta     | "new finding" vs "same finding, new site"                                                                          |
| **L4 counterfactual** | ask for the consequence, not the similarity                   | not _"are these duplicates?"_ but _"does merging them delete code?"_ — the discipline `evidence.ts` already states |

## joggle, rule by rule

The thirteen worth deepening first, in the order the audit ranks them.

| rule                                                       | what it asks today                    | the fact to add                                                                                    | after                                                                                           |
| ---------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `shallow-module`                                           | `grab_bag`, `job`                     | export cohesion: which external surfaces each export touches, and reachability in the import graph | one judgment: _which_ module splits, as a `Choice` over candidate partitions                    |
| `temporal-coupling`                                        | `verdict`, `worth_fixing`             | acquire/release pairs and escape paths from the control-flow graph                                 | judgment only on `worth_fixing`, with the escape path shown                                     |
| `name-as-address`                                          | `fails_as_address`, `address`         | fan-out and call-site count from the surface index                                                 | pure fact; escalates severity by fan-out, no judgment                                           |
| `compose-types`                                            | `verdict`                             | field-set containment plus construction sites                                                      | judgment only on _"same concept?"_, given both field sets                                       |
| `structural-collapse`                                      | `verdict`                             | containment over fragment sets — already computed for rung 1                                       | judgment becomes a `Choice`: which of these is the primitive                                    |
| `duplicate-implementation` / `-meaning` / `restated-value` | eight questions each                  | fragment equality and capture sets are facts                                                       | keep `consequence` (would merging delete code?) and `canonical` (which survives); drop the rest |
| `reversal`                                                 | `expand`                              | field-set difference, computed                                                                     | ask only the name of the combined type                                                          |
| `naming-drift`                                             | `one_concept`, `verdict`, `operation` | identifier index and co-occurrence in one module pair                                              | ask only when both spellings appear in the same neighbourhood                                   |
| `reimplemented-primitive`                                  | `same`                                | export signature, arity, parameter types from typefacts                                            | ask the consequence: _"would adopting this export delete the hand-rolled lines?"_               |
| `field-type-drift` / `nullability-drift`                   | `verdict`                             | the types themselves are facts                                                                     | ask only _"meant to be the same field?"_, when names match and types differ                     |
| `language-drift`                                           | `concept`                             | vocabulary index over identifiers and docs                                                         | ask only for words frequent in prose and absent from every identifier                           |
| `hoist-to-domain`                                          | `duty_family`, `home`, `duty`         | the actual domain packages and the import graph                                                    | `home` becomes a `Choice` over real packages                                                    |
| `rule-judgment`                                            | `decides_in_code`, `kind`             | the audit's own classification                                                                     | self-application: this rule should read `question-audit.md`                                     |

## Plumb, five deepenings

Plumb runs per file with an AST and no cross-file vision, which is exactly why the store
matters here: the facts it lacks are the ones the store already has.

1. **Read the surface index read-only.** A per-file rule can then ask "how many files import
   this?" and escalate by fan-out — `no-generic-export-names` becomes measurable instead of
   stylistic, and `name-as-address` becomes available to plumb as well as joggle.
2. **Weight by rarity.** `df` is a column. A finding for a pattern that appears once in 3,570
   declarations is not the same severity as one that appears 900 times, and today both read
   identically.
3. **Make `no-reinterpret-cast` ask what the cast crosses.** The interesting cast is the one at
   a parse boundary; a cast between two local type aliases is noise. The parameter and return
   types are already available to the type-aware run.
4. **Finish the rule-pair fixes.** `Option`/`Either` is settled (`absence-shape.ts`);
   `no-optional-function-parameters` vs `no-duplicate-type-constituents` is only settled in a
   message today, and should be a fixture.
5. **`prefer-property-tests` should read the assertions.** "No fast-check import" is a proxy.
   The real question is whether the suite exercises a round trip or a boundary; a suite with
   hand-picked `expect` chains and a suite with one generated property are different, and only
   the AST can tell them apart.

## The deepest one, and it is not per rule

The audit's own headline is the deepening: **12 of 67 judgments ask for a fact the workspace
holds.** Each is a named line in `docs/question-audit.md` with the fact that replaces it. The
work is not to write better questions; it is to write the twelve facts and delete the twelve
questions, then re-run the audit and see what the next twelve are.
