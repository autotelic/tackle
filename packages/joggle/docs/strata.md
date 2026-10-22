# Strata

A domain migration is not one move. It is four strata, one arrow, and four
questions no single-file rule can ask.

**What it settles:** which stratum a value belongs to, and therefore which engine
can hold the rule — `plumb` where one file can see it, `joggle` where it takes two.

This was written against a real migration: a monetised forestry system moving its
rules out of 1469 `knex` call sites and 474 hand-written row types into one domain
package. The counts are the argument, not the subject. Nothing here depends on that
repository, and a repository with no such migration should enable none of it.

## The four strata

| # | Stratum | What it is | How many | Correctness | Failure |
| --- | --- | --- | --- | --- | --- |
| 1 | **values** | `Money`, `Hours`, `Year`, `Percentage`: one representation per concept | singular | **parse** — a value that exists is well formed | two shapes drift under change |
| 2 | **facts** | append-only records: a decision, its instant, its authority, its inputs | grows only | **identity** — never rewritten | the past stops being reproducible |
| 3 | **derivations** | projections chosen for cheap reads, joins and aggregates | plural | **agreement with facts** | two numbers disagree and both are cached |
| 4 | **transport** | the wire | per endpoint | **round-trip** | a producer's value has no representation |

Two laws hold the strata apart, and both are enforceable:

1. **No cost-driven shape may leak upward.** A `left join`'s nullability is a
   retrieval artifact. It must not become a nullable field in a value, or the
   value now claims the business is uncertain about something it is certain about.
2. **A fact is never re-derived.** Rules change; records do not. A payroll run is
   not `rules(currentData)` — it is what was decided on a date, from inputs that
   may since have changed.

The first law is what `schema-excludes-domain-value` and `nullability-drift`
already hold, from opposite ends. The second has no rule at all, which is the
largest gap this document names.

## Three verbs

Applications **decide**, **record**, and **report**. The strata are what each verb
writes:

| Verb | Writes | Lives in | Failure when the verb is unnamed |
| --- | --- | --- | --- |
| decide | facts | values + rules | a rule in SQL is invisible as a rule |
| record | facts | stratum 2 | decisions get mutated instead of superseded |
| report | derivations | stratum 3 | staleness becomes an opinion |

Collapsing *decide* and *report* into "logic" is exactly how business logic comes to
live in a query. That is not a style problem; it is the missing verb.

## The four hard parts

Each is a rule target, and none is reachable from one file:

1. **Time.** `inferred-over-recorded` and `no-redundant-derived-field` are the same
   defect at two sizes: a value the code recomputes that a record already froze. The
   general question is *fact or derivation*, and it is asked per column.
2. **Staleness.** A projection is a **materialized function**. It has three
   properties — what it is a function of, how stale it may be, how it is refreshed —
   and a projection that states none of them has staleness by assumption. The
   business decision (may this be five minutes old?) is not a query decision.
3. **Deviations.** Real businesses accrete overrides, approvals and disputes that
   contradict a rule on purpose. Rules compose; **choices do not**. The symptom is
   already caught by `plumb/no-boolean-field-signals` and
   `plumb/no-product-of-state-booleans` — a boolean gating nullable siblings — but
   the design question behind the symptom has no rule.
4. **Invariants.** Properties that span rows and time (delivered = planted +
   destroyed) cannot be parsed into existence at any boundary. They are
   **reconciled**: declared once, detected, repaired, and the residual reported. A
   domain package of pure functions offers *local* correctness only; the global
   guarantee needs a repair path somewhere, and no rule asks whether one exists.

The fifth is vocabulary rather than structure, and it is the one place where the
existing rules need criteria rather than candidates: **a shared unit is one type; a
shared word is not.** `naming-drift` and `one-concept-one-type` already ask whether
two declarations are one thing; the strata add the answer's split. Same word, same
rule → one type. Same word, different rule → two types and an explicit mapping at
the boundary. A global ontology of terms is how a tree count comes to mean two
things in two reports.

## Where a rule can live: the split test

`require-judged` already states the law: if a deterministic predicate can decide
it, it goes to plumb, and a joggle rule for it is rejected. Apply it per stratum:

| Question | One file can answer | Engine |
| --- | --- | --- |
| does this module import the database? | yes | plumb |
| is this value field nullable or optional? | yes | plumb |
| is this number coerced out of a row? | yes | plumb |
| is an instant a `string` here? | yes | plumb |
| does anything parse before this declaration is exported? | yes (local absence) | plumb |
| is this column a frozen fact or a recomputation? | no | joggle |
| may this projection be stale, and does it say so? | no | joggle |
| is this record append-only, and is it treated so? | no | joggle |
| is this field a deviation from a rule? | no | joggle |
| what restores this invariant when it breaks? | no | joggle |

Note the asymmetry: **plumb can only ever hold the leaks; joggle holds all five
structural questions.** Nothing above stratum 2 is visible to a single-file rule,
which is why a migration enforced by lint alone converges on correct types and
incorrect architecture.

## What already exists

Do not add these again. Read them first, then extend or compose.

| Rule | Stratum / edge | What it already holds |
| --- | --- | --- |
| `joggle/hoist-to-domain` | values ← edge | a rule living at the edge, with duty and home judged separately |
| `joggle/types-over-logic` | values | a guard clause where a brand should carry the guarantee |
| `joggle/schema-excludes-domain-value` | values → transport | a wire schema that cannot hold a value the domain produces |
| `joggle/nullability-drift` | derivation → transport | a column's nullability against a schema's, via `.annotate({ sourceColumn })` |
| `joggle/field-type-drift` | values, twice | one field, two declarations, two types |
| `joggle/naming-drift` · `one-concept-one-type` | values, contexts | whether two names, or one name twice, are one concept |
| `joggle/duplicate-meaning` | values, contexts | one meaning implemented twice |
| `joggle/inferred-over-recorded` | facts vs derivations | a computed value a record already carries |
| `joggle/unaccounted-drop` | facts → derivations | a shared path that discards items without saying so |
| `joggle/unbounded-default-read` | derivations | a read whose default path has no bound |
| `plumb/no-redundant-derived-field` | facts vs derivations | a field the code could derive |
| `plumb/no-boolean-field-signals` · `no-product-of-state-booleans` | deviations | an override encoded as a flag |
| `plumb/prefer-payload-brand` | values | an opaque brand hiding its payload behind a cast |
| `plumb/no-nondeterministic-core` | rules | a rule that would not be true of the company on Tuesday |

The gaps below are therefore *five* judged rules and *four* deterministic ones —
not a suite. Each
one is written to the anatomy in `rule-anatomy`, keeps its threshold in `policy.ts`,
and has an ignore it should expect.

## Backlog: plumb

Deterministic, single-file, no model, no budget.

### `plumb/no-row-coercion`

**Candidate.** `parseFloat(x)`, `parseInt(x)`, `Number(x)` applied to a member
expression, in a module that calls the query builder.

**Why plumb.** It is syntax plus one import; the only judgment is "is this a
coercion", and that is a parse.

**Message.** A number read out of a row is text from the driver, not a number.
Decode it through the domain's schema, so the conversion has one implementation and
one failure.

**Expected ignore.** A `Number(query.year)` on a search parameter — that is a
transport coercion, not a row one, and the candidate filter above excludes it.

### `plumb/no-nullable-value-field`

**Candidate.** Inside the declared values path, a `Schema.Struct` field whose
constructor chain contains `NullOr`, `UndefinedOr` or `optionalKey`.

**Why plumb.** Path plus constructor chain; both in the one file.

**Message.** Absence is a property of a projection, not of a value. If this field is
genuinely absent by nature, say so once where the concept is defined; otherwise
project the partiality into the derivation that reads the database.

**Expected ignore.** A value that is absent by design — an "ended on" that may not
have happened — which needs an explicit escape comment, and the escape is the point:
the author has to distinguish *absent by nature* from *nullable because a join*.

### `plumb/no-adapter-in-values`

**Candidate.** Any import of the query builder, a driver, the HTTP framework, or a
queries path, from the declared values path.

**Why plumb.** One import statement.

**Message.** The domain depends on nothing internal. This is the law as a failure
instead of a sentence in a README.

### `plumb/no-string-instant`

**Candidate.** In the declared values path, a `string` field whose name ends in
`At`, `Date`, `timestamp`, or matches a `_at` column.

**Why plumb.** Name plus annotation, both local. The wire half is already covered by
`nullability-drift` and `schema-excludes-domain-value`; this is the value half.

**Message.** An instant is a value with an identity, not the text of one. Text is
transport, and two text formats that agree today will disagree after a timezone.

## Backlog: joggle

Judged, cross-file, one question per rule, each with a deterministic candidate half.

### `joggle/fact-or-derivation`

**Candidate.** A unit that writes a column computed from other columns — a refresh,
a snapshot, a batch job — and a reader of that same column.

**Deterministic half.** The write, its target column, and the reader, from the
import graph and the units' bodies.

**Question.** Is this column a decision frozen at an instant, or a cheap
recomputation of current data?

**Labels.** `fact` · `recomputation` · `neither`. The finding is a
`recomputation` on a structure that is supposed to be append-only: every change to
the rules silently rewrites the past.

**Expected ignore.** A genuinely cheap derived column that is refreshed by policy,
which is exactly the `declared-staleness` case below and should not be counted twice.

### `joggle/declared-staleness`

**Candidate.** An exported read of a denormalised structure — a name matching
`snapshot`, `summary`, `materialized`, `cache`, `totals` — or a structure whose
columns repeat another table's.

**Deterministic half.** Whether a staleness declaration exists near it (a policy
constant, a refresh call, a TTL, a doc comment) and what it says.

**Question.** May this data be stale?

**Labels.** `allowed` · `must_be_current` · `not_a_projection`. An `allowed` with no
declaration found is the finding: the answer lives in someone's head.

**Expected ignore.** A projection whose staleness is declared in a scheduler the
reader never imports. The ignore should name where it is declared, and that naming is
the documentation.

### `joggle/append-only-honoured`

**Candidate.** A write to a structure whose name or role marks it as a record —
`audit`, `run`, `snapshot`, `ledger`, `invoice`, `payment`, `history` — using
`update`, `upsert`, or `delete`.

**Deterministic half.** The write verb and the target, from the query builder call.

**Question.** May this record be rewritten?

**Labels.** `supersede_only` · `mutable` · `not_a_record`. A `supersede_only`
reached by an `update` is the finding, and the move is **expand**: the record needs a
supersession, not a correction.

**Expected ignore.** A status transition on a mutable work item that happens to be
named like a record; the name was never a promise.

### `joggle/deviation-has-a-shape`

**Candidate.** A type or table with a boolean flag that gates nullable siblings, or
an override cluster — `*_override`, `*_original`, `*_reason`, `*_by`.

**Question.** Is this a decision that contradicts a rule, or a state of the world?

**Labels.** `deviation` · `state` · `neither`. Where plumb reports the shape, this
reports that the concept is missing: a deviation needs an authority, an instant, a
reason, and a link to what it contradicted. A cluster of nullable columns is a
deviation that decided not to be one.

### `joggle/invariant-has-a-reconciler`

**Candidate.** An exported predicate or assertion over a set — `every`, `sum`,
`balance`, `reconcile`, `assert`, `check` — that reads two or more tables or spans
rows, in the values or rules stratum.

**Question.** If stored data violates this, what restores it?

**Labels.** `repair_path` · `detect_only` · `not_an_invariant`. `detect_only` is the
finding: the system can tell you the books do not balance and can do nothing about it,
which is a local guarantee reported as a global one.

**Expected ignore.** A validation that must remain detect-only because repair needs a
human decision. Naming that is the correct outcome, and the rule should treat it as
satisfied rather than suppressed — a deviation with an authority, again.

## Vocabulary debt

Rules 5–9 need three duties, and `dutyVocabulary` has none of them today. Each
addition should say why the nearest existing label is wrong, the way
`moduleRoles.library_core` does:

- **`recording`** — freezes a decision with its instant and authority.
  `orchestration` is the nearest label and it is wrong: recording owns the *rule*
  that the record may not be rewritten. `infrastructure` is wrong for the same reason
  it is right for a query: the database is where it lands, not what it is.
- **`derivation`** — materialises a view of records for cheap reads.
  `mechanical` is the nearest label and it says *no business meaning*, which is the
  opposite of the problem: a stale projection is a business claim made from data.
- **`reconciliation`** — restores an invariant across records. `domain_logic` is
  nearly right and is exactly what makes it dangerous: it invites the repair to be
  read as a pure function, when the thing being repaired is stored data.

**Refused:** a `unit-or-term` rule. `naming-drift` and `one-concept-one-type`
already ask whether two things are one thing; a third rule asking it a third way is
`duplicate-meaning` applied to the rulebook. Extend their criteria instead, and let
the strata supply the answer split.

## What would make this wrong

- If most queries turn out to return a declared wire schema and stop there, rules 5
  and 6 have almost no candidates and the toolchain is a tax. Measure the distance
  from row to wire before writing them.
- If the append-only structures are already written by a single job, rule 7 is a
  one-time review, not a rule.
- If `detect_only` dominates rule 9's verdicts on the first run, the repository has no
  repair culture and the rule is describing an organisation, not code. That is a
  finding about the repository, and it belongs in the report rather than in a
  backlog item.

The honest exit: these rules exist to make a migration's *shape* visible while it is
in progress. Once the strata are where they belong, the findings should approach
zero without ignores — and the rules that remain are the ones holding the two laws,
not the ones describing the journey.
