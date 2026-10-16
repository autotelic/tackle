# Coupling the two single-file rulebooks

joggle is the cross-file layer. On its own source, two single-file rulebooks run:

- **plumb** (`@autotelic/plumb`) — the house rules, 49 generic and 23 Effect. The
  opinionated one: shapes, boundaries, ownership, tests, exports.
- **`@effect/tsgo`** — the Effect language service's diagnostics, exposed as 116
  type-aware Oxlint rules. The upstream opinion on what Effect code should look
  like, split into correctness, anti-pattern, Effect-native, and style.

This is the same question `rule-coupling.md` asks of joggle's own rules, one level
up: do two rulebooks that overlap report the same thing twice, and where they
disagree, which one is right?

## Where they converge

Convergence here means the same concern reached from two directions. It is not
automatically duplication — the scopes differ — but a reader should know the pair.

| concern | plumb | effect-tsgo | relation |
| --- | --- | --- | --- |
| nondeterministic globals | `no-nondeterministic-core` (random, date, crypto; outside tests) | `global-date` / `-in-effect`, `global-random` / `-in-effect`, `crypto-random-uuid` / `-in-effect`, `global-timers` / `-in-effect` | plumb is one coarse rule; effect-tsgo splits by API and by in/out of a generator, and adds timers. Overlap on random/date/crypto. |
| direct HTTP | `no-direct-fetch` | `global-fetch` / `global-fetch-in-effect` | near-duplicate; plumb subsumes both, effect-tsgo adds the in-Effect split. |
| raw `try`/`catch` | `no-try-catch` (all, with a SAFETY exception) | `try-catch-in-effect-gen` (inside generators only) | effect-tsgo is the subset; plumb subsumes. |
| `Effect.provide` shape | `no-cascading-layer-provide`, `no-nested-layer-provide` | `multiple-effect-provide`, `strict-effect-provide` | overlapping axes: nesting/cascading vs chaining/entry-points. `strict-effect-provide` is the stricter (entry-points-only) reading. |
| JSON | `no-unguarded-json-parse`, `require-canonical-stringify-for-identity` | `prefer-schema-over-json` | partial overlap on `JSON.parse`/`stringify`; different remedies — the error channel and canonical identity vs a Schema. |
| decoding | `no-decode-unknown-option` | `prefer-typed-schema-decoder` | both push off the untyped decoder; different construct (Option vs `decodeUnknownResult`). |
| deriving a schema's type | `require-schema-type-derivation` (currently off) | `prefer-schema-type-property` | same goal, different spelling. effect-tsgo's is the one that works, which is why plumb's is off. |
| swallowing a failure | `no-silent-error-swallow` | `catch-to-ignore` | overlap on `catch → void`, **opposite remedies** — see tensions. |
| `Match` / `gen` for control flow | `prefer-effect-match`, `prefer-effect-gen-for-guard-ladders` | `match-effect-to-match`, `effect-do-notation`, `unnecessary-effect-gen` | overlapping intent, different triggers (ternary ladders and flatMap chains vs `matchEffect` and `Do`). |
| Option idioms | `guarded-op-must-return-option`, `prefer-option-pipeline` | `prefer-succeed-some-or-none`, `map-some-to-as-some`, `option-match-to-from-option` | different layers: plumb governs return contracts, effect-tsgo the API used inside them. |

## Where they disagree

Two pairs do not merely overlap; they pull opposite ways.
- **Schema classes.** plumb's `no-schema-class-modeling` says do not reach for
  `Schema.Class`/`TaggedClass` as a default; model records with `Schema.Struct`,
  variants with `TaggedUnion`, errors with `TaggedError`. effect-tsgo's
  `new-schema-class` says that when you do have one, construct it with
  `.make(...)`, not `new`. Both can be satisfied at once — and both fire on the
  same `new SchemaClass(...)` line, which is the honest signal that the codebase
  is using a pattern one tool discourages and the other merely refines.
- **Swallowing.** plumb's `no-silent-error-swallow` forbids reducing a failure to
  `Effect.void`; effect-tsgo's `catch-to-ignore` suggests `Effect.ignore` for
  exactly that shape. plumb is saying "do not lose the failure", effect-tsgo
  "if you mean to, say so with the named combinator". The house rule is stricter
  and wins; effect-tsgo's is the refactor you make when you have decided to
  swallow and want it visible.
- **A wire schema's width.** `effecttsgo/schema-number` wants a domain number
  written `Schema.Finite`. joggle's own `schema-excludes-domain-value` then fires:
  the narrower schema no longer admits what a `: number` domain field can
  produce, and joggle reported the mismatch 29 times. Resolved against
  effect-tsgo, because joggle's rule is about correctness at the wire and
  effect-tsgo's is a style preference: the schemas stay `Schema.Number`, and
  `effecttsgo/schema-number` is off in `oxlint.config.ts` with that reason.


- **A schema's type, spelled twice.** Within the Effect rulebook itself,
  `prefer-schema-type-property` and `unnecessary-typeof-type` pull both ways on
  one spelling: the first rewrites `Schema.Schema.Type<typeof X>` to
  `typeof X.Type`, and the second then says a named type exists, so use that. The
  pair is only consistent once the named type is checked for first: `typeof
  X.Type` where no named type exists, and the named interface where one does. The
  fix obeyed both; what was left over is a disagreement the two rules had with
  each other, not with the code.

## Coverage each one adds

- **Only effect-tsgo reaches the type channels**: `missing-effect-context`,
  `missing-effect-error`, `missing-layer-context`, `floating-effect`,
  `leaking-requirements`, `unsafe-effect-type-assertion`, `any-unknown-in-error-context`.
  plumb has no equivalent, and these are the rules most specific to Effect.
- **Only effect-tsgo prefers the Effect-native API**: console, date, fetch,
  random, timers, `process.env`, `node:` builtins, promises, async functions,
  `Schema` over JSON, `instanceof` over `Schema.is`.
- **Only effect-tsgo knows the Effect idioms** — the ~50 `catch-*`, `flat-map-*`,
  `match-*`, `effect-map-*`, `map-some-*`, `unnecessary-*` refactors.
- **Only plumb reaches shape and ownership**: `no-object-parameters`,
  `no-multiple-function-params`, `no-boolean-field-signals`,
  `require-exhaustive-tag-switch`, `no-barrel-export-star`, ordering
  (`require-published-order`, `require-sort-comparator`), JSDoc, tests
  (`require-property-tests`, `no-module-mocking`), and the canonical-stringify
  rule for identity.

## Decision

**Both rulebooks stay on, and no rule is disabled for overlapping.** The overlap
is eight families; the coverage each adds is most of its own list. The two
near-duplicates (`no-direct-fetch`, `no-try-catch`) do not currently fire, and
when they do, one line reported by two rules whose scopes differ is a smaller
cost than the coverage lost by turning either off.

If a line ever becomes noisy because two rules agree on it, the rule is: **the
house rule wins, and its effect-tsgo twin is turned off here with the reason**,
the way `require-schema-type-derivation` is already off. Nothing is turned off
speculatively.

One effect-tsgo rule is off for a reason of its own, not for overlap:
`missing-pipeable-signature` wants every exported fixed-arity function to carry a
pipeable overload. That is right for a library whose functions compose through
`.pipe`; joggle's exported functions are data-first and called directly, so the
rule describes a shape this is not. It is off in `oxlint.config.ts` with that
sentence beside it.

## Documented exceptions, not suppressions

Four more rules disagree with the code rather than with each other, and each is
off exactly where it does, with the reason beside it in `oxlint.config.ts`:

- `strict-effect-provide` for the three entry points — the rule's own carve-out.
- `no-conditional-empty-object-spread` where a config key must be *absent*, not
  present-and-undefined, which is the distinction `exactOptionalPropertyTypes`
  makes and the conditional spread preserves.
- `no-known-value-widening` for lookup tables indexed by a runtime string, where
  the annotation is the index signature the table needs.
- `prefer-schema-over-json` where canonical JSON is the identity — the same
  decision plumb's `require-canonical-stringify-for-identity` requires from the
  other side.

`no-shape-in-symbol-names`'s exception grew to every file that uses `shape` as
the domain word, which is the reason it was already excepted for five files.
