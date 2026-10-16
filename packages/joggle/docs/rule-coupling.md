# Rule coupling: meaning decided in code

joggle's design rule is **be deterministic where you can prove, and judge only
where you must.** There are three things a rule can do with a piece of code, and
only two of them are allowed:

1. **Collect a fact.** The AST says a call site exists; the type trace says an
   expression's resolved type; the import graph says who imports whom. Facts are
   cheap, exact, and do not care what the code is *called*.
2. **Ask a question.** Jev decides what a fact means.
3. **Recognise a pattern.** A regular expression over the source, a list of names,
   a hand-ranked score -- deciding meaning in code, and then asking the model to
   confirm it.

The third is not a fact and not a question. It is a person's opinion wearing the
costume of a fact, and it is the failure `docs/two-regimes.md` names and
`joggle/rule-judgment` exists to find. It has two costs the other two do not:

- **It is coupled to one implementation.** `toFixed(2)` and `formatDollar` are
  how *this* repository spells money today. Rename the helper, adopt a currency
  library, format dates with `Temporal` -- the rule needs editing. The whole point
  of Jev is that the rule does not: the fact is the call site and the resolved
  type, and the meaning is the question.
- **It decides the thing Jev is for.** A pattern that says "this looks like money"
  has already answered the question, and the model is reduced to confirming it --
  which is why these rules agree with their own generator so often
  (`docs/calibration.md`).

### The test

> If I changed the naming convention, the library, or the language idiom -- and
> the *structure* of the code were unchanged -- would this rule need editing?

If yes, the rule is coupled.

## The audit

Every rule, by what its deterministic half actually does.

| rule | what the code decides | verdict |
| --- | --- | --- |
| `single-path` | `DOMAINS`/`HELPER_NAME`/`HELPER_BODY`/`INLINE`: which strings look like money, a percent or a date, and which names are formatters | **removed** — it shipped the fault, not a fix |
| `unaccounted-drop` | `ADAPTER_NAME`/`ADAPTER_PATH`/`SKIPS`/`ITERATES`/`ACCOUNTS`: which functions are adapters, which skip, which account | **removed** — same |
| `temporal-coupling` | `PAIRS`: `lock`/`unlock`, `acquire`/`release`, … | **declared convention** — moved to `policy.temporalCoupling.pairs` |
| `field-type-drift` | `minWords` and `canCompose`: string rules for whether two types are compatible | **fixed** — the fact is a field declared two ways; the question decides compatibility |
| `compose-types` | the same `canCompose` | **fixed** — `canCompose` deleted; containment is field-NAME containment |
| `reimplemented-primitive` | `inputKey`/`argKey`: string shapes standing in for "the same inputs" | **coupled** — next |
| `hoist-to-domain` | `ruleLikeness`: imported +3, typed +2, comparisons +2, a number +1, a doc +1 | **coupled** — next; the detector cannot see a score |
| `language-drift` | `STOPWORDS` and `termsOf` | **fixed** — `STOPWORDS` deleted; every term is a candidate |
| `naming-drift` | `NON_DISTINGUISHING` and `worthJudging` | **fixed** — the word list is deleted; `worthJudging` keeps only the structural part |
| `types-over-logic` | `BARE`/`NULLABLE`, `GUARDS`, `declaredTypeOf` | **fixed** — guard facts + `workspace.types`; no regex, no vocabulary |
| `page-needs-composition` | `isPage`: `/^(route|page)\.tsx?$/` and `/modal/i` | **fixed** — deleted; the `role` question already decides what a file is |
| `data-error-as-outage` | `STATUS_METHODS` (`code`, `status`, `statusCode`) | **framework vocabulary** — a language fact, like the `node:` builtins in `dependency-fit` |
| `doc-matches-code` | `messageLiterals` and doc extraction | borderline -- parsing prose is unavoidable; the comparison is judged |
| `rule-judgment` | patterns for switch/threshold shapes | borderline -- it is *about* proxies, and its inputs are structural |
| `object-shape` | field-set equality and subset-of-declared | fact |
| `name-the-primitive` | field co-occurrence | fact |
| `duplicate-implementation`, `duplicate-meaning` | shape hash, resolved type signature, similarity | fact |
| `call-pattern`, `duplicate-call-run` | resolved call sequences (`unit.calls`, `callSignature`) | fact |
| `one-concept-one-type` | the tsgo type trace | fact |
| `nullability-drift` | migration columns plus schema `nullable`/`sources` | fact |
| `import-architecture` (3 rules) | the import graph and the declared layers | fact |
| `dependency-fit` | imports, manifests, node builtins | fact |
| `name-as-address` | exported + one-word name + caller count | fact (the one-word test is a name SHAPE; the regex became the property) |
| `shallow-module` | export count and implementation lines | fact |
| `module-direction` | the import graph plus model-classified roles | fact + judged |
| `bundle-conformance` | bundle structure against the pattern's own `TRIPARTITE` spec | fact (a declared spec, not a proxy) |

## Declared conventions

Two rules keep a vocabulary, and they are a different thing from the coupling
above. `temporal-coupling` knows that `lock` pairs with `unlock`;
`data-error-as-outage` knows that `status`, `code` and `statusCode` are how an
HTTP framework names a response code. Neither is derivable from the code: which
operations acquire and release is knowledge about resource APIs, and the method
names are a language fact like the `node:` builtins `dependency-fit` already
uses.

The honest treatment is not to ask Jev to rediscover it and not to hide it in the
rule. It is to declare it:

- `temporal-coupling`'s pairs live in `policy.temporalCoupling.pairs`, reviewable
  and overridable, and the rule's judgement (is this acquire unpaired?) is still
  the model's.
- the composition preset's `{ state, actions, meta }` spec and
  `data-error-as-outage`'s method names are the same kind of thing: the pattern
  being enforced, not a proxy for it.

Their `meta-allow: no-pattern-classifier` says exactly that, with the reason.
A declared convention is legible; a hidden pattern is not.

## How to fix it

A coupled rule is fixed by moving its decision from (3) to (1) and (2): collect
the structural facts, then ask. Two pieces of substrate are missing:

**AST facts.** `StructureFacts` today carries call sites, JSX element names, object
literals and migration columns. The coupled rules reach past it into
`unit.text` because it does not carry what they need:

- **string construction** -- template literals and `+` concatenation, with the
  references they interpolate (`single-path`);
- **guard shapes** -- an `if` and the test's structure (`types-over-logic`);
- **flow** -- `continue`, `throw`, early `return`, and the value returned
  (`unaccounted-drop`);
- **member calls and literals** -- the callee, the receiver, the arguments
  (`field-type-drift`, `reimplemented-primitive`).

**Type resolutions.** `canCompose`, `inputKey`, `BARE` and `isWide` are all
string rules standing in for a type question that the tsgo trace answers exactly.
`src/typetrace.ts` and the `--types` path already exist; the coupled rules do not
use them.

With those two, a rule's deterministic half is exactly what the design rule says:
*a fact from the AST or the type trace, and a question about what it means.*

## Order

1. **Substrate first.** Add the AST facts and wire the type trace to the rules
   that need it.
2. **Then the rules.** Rebuild `single-path` and `unaccounted-drop` on the
   facts (they are new and can be removed cleanly until then), then
   `temporal-coupling`, `field-type-drift`, `compose-types`,
   `reimplemented-primitive`, `hoist-to-domain`, `language-drift`,
   `naming-drift`, `types-over-logic` and `page-needs-composition` one at a time,
   each with its question re-calibrated.
3. **The fence is in.** `no-pattern-classifier` is a meta-rule (`src/meta.ts`)
   that reads a rule module's own source for the two mechanically detectable
   kinds: a regex literal, a `new RegExp`, or a literal vocabulary (a named array
   or a `Set` of short quoted words). It is the same shape as the other
   authorship rules, with the same escape hatch: a rule states
   `meta-allow: no-pattern-classifier` and a reason.

   Five rules have come off the debt and eight were on it: `types-over-logic`,
   `field-type-drift`, `compose-types`, `language-drift`, `naming-drift`,
   `page-needs-composition` and `name-as-address` now collect facts, and the
   opt-out is gone. Two remain and name their reason: `temporal-coupling` (a
   declared convention in policy) and `data-error-as-outage` (the HTTP
   framework's method names). `reimplemented-primitive` (`inputKey`) and
   `hoist-to-domain` (`ruleLikeness`) are still coupled and are the next two.

   Two limits, stated rather than hidden. The detector is mechanical, so it does
   not catch a hand-ranked score (`ruleLikeness`), a string rule for a type
   question (`canCompose`, `inputKey`) or a text parse for a declared type;
   those are found by reading, and they are in the table above. And it reads
   structure, not meaning: `name-as-address`'s one-word test is a name SHAPE, not
   a classification, and is allowed for that reason. `joggle/rule-judgment` is
   the runtime sibling -- it finds this category in a repository's rules; this
   finds it in joggle's own.

## The review rules: built, and not

Five of the eight rules from the reviews are built, each on facts:

| rule | the two facts |
| --- | --- |
| `single-path` | an AST string site; the call graph |
| `unaccounted-drop` | a `continue`; an exported boundary |
| `generic-carries-a-caller` | a string literal or JSX text; the files that call or render the unit |
| `schema-excludes-domain-value` | a `Schema.Struct` field's constructor chain; a domain field of the same name |
| `meaning-switched-by-flag` | a `boolean` field; a guard whose test names it |

And one is not built on purpose. The gate from PR 1579 (an unused import reaching
main) is a CI and oxlint job, not a joggle rule: a deterministic predicate belongs
in the linter or the typechecker, and `require-judged` rejects one here.

## Both fact layers are in

The last two rules needed facts joggle did not extract. Both layers now exist.

**Node types by offset** (`src/typefacts.ts`, `--types`). The checker's type at a
byte position, from the native-preview API that ships with the `tsgo` binary
joggle already runs -- no fork. The join is by OFFSET, which both the checker and
the oxc parser read from the same file, so it is exact; that is the join the
declaration trace cannot make. `check.ts` collects the positions of the `return`
arguments in scope (a new `returns` fact), asks once per run, and puts the lookup
on `RunContext.nodeTypes`.

**Data access** (`CallSite.argumentCount`, `CallSite.argumentKeys`, and
`StructureFacts.allOptionalFunctions`). Which arguments a call passes, and whether
the callee's every filter is optional -- the shape of a query whose default path
is legal and unbounded.

And the rules:

| rule | the facts |
| --- | --- |
| `inferred-over-recorded` | a comparison (an AST operator, a language construct) and a return; the unit names a type; that type records a boolean it does not read |
| `unbounded-default-read` | a call to a function whose every filter is optional; the callee's declaration; the data package its file imports |

Both are a candidate generator plus a question, and neither is blocked on Jev.
