# Type resolution

JOGGLE.md says the next layer is types, not more AST, and names the goal:
one concept, one type, enforced. This note records how **Effect-TS/tsgo** does
type resolution, because it is the one production system that already runs
general rules through the TypeScript-Go checker and it is a working template for
the layer joggle wants.

Source of every claim: a shallow clone of
`https://github.com/Effect-TS/tsgo` at commit
`9652243fa2118971a08190d551357118130cf141` (2026-09-17), kept in
`repos/effect-ts-tsgo/` (gitignored). Paths below are relative to that clone.
Nothing here is copied; the mechanism is what transfers.

## What joggle does today

joggle parses with oxc and normalises declaration text. Two things are called
"resolved" in the current code and neither is type resolution:

- `src/workspace.ts` builds `typeRefs` and `typeSignature` by following a type
  *name* to the file that declares it. That is symbol resolution over joggle's
  own index.
- `src/rules/field-type-drift.ts` compares the **annotation text** of a field
  (`unit.fieldTypes`), so `string` and `number` are different and
  `User`/`Partial<User>` need `canCompose` to be reconciled.

The checker is used only as a process: `src/tsgo.ts` runs
`tsgo --listFilesOnly` for project discovery and `tsgo --noEmit` to carry tsc
diagnostics. No rule ever asks what a type *is*.

The judged rules send an evidence panel (`baseEvidence` in
`src/rules/cluster-verdict.ts`): `symbol`, `kind`, `path`, `line`, `source`,
`documented`, `doc`, and `types` (the names only). The model sees text and
names. It never sees a resolved shape.

## The three ideas that matter

### 1. Run inside the checker, after each file is checked

`etscheckerhooks/init.go` registers one callback:

```go
checker.RegisterAfterCheckSourceFileCallback(afterCheckSourceFile)
```

The callback receives the `Program`, the `Checker`, and the `SourceFile`, and
runs every rule against the fully type-checked program. There is no subprocess
and no trace file. The program is already built, so asking the checker a
question costs a lookup, not a compile.

### 2. Put a facade and a cache in front of the checker

`internal/typeparser/type_parser.go` defines `TypeParser{program, checker, links}`.
Every parse goes through `Cached(store, key, compute)`, which stores the result
in a `core.LinkStore` and **caches the negative result too**:

```go
func Cached[K comparable, V any](store *core.LinkStore[K, V], key K, compute func() V) V {
    if value := store.TryGet(key); value != nil { return *value }
    value := compute()
    *store.Get(key) = value
    return value
}
```

The link stores live on a field the fork adds to the checker itself
(`_patches/typescript-go/023-checker-effect-links.patch`: `EffectLinks any` on
`Checker`), so the cache has the same lifetime as the checker and is shared by
every rule and every file.

`internal/typeparser/get_type_at_location.go` wraps `GetTypeAtLocation` with the
guards the raw call needs: reject non-expression/non-type/non-declaration nodes,
skip JSX tag and attribute names, skip an `ImportClause`, skip a tagged-template
expression and a `import.defer` meta-property, and `recover()` from checker
panics. This is the difference between "we can call the checker" and "we can
call it 1,870 times without a crash": the guards are **hard-won and specific**,
and any host that calls the checker directly needs its own copy.

### 3. Identify a type by a marker, not by a name

`internal/typeparser/effect_type.go` is the heart of it. An `Effect<A, E, R>` is
recognised and its three parameters extracted **structurally**:

- Effect v4 encodes the channels in a variance struct under the property
  `~effect/Effect` (`EffectTypeId`). Detection is one property lookup:
  `GetTypeOfPropertyByName(t, EffectTypeId)`.
- `parseVarianceStruct` reads `_A`, `_E`, `_R`. Each is **covariant**, so it is
  stored as `() => A` and the value is the **return type** of that function
  (`extractCovariantType` in `internal/typeparser/helpers.go`).
- v3 has no stable property name, so it iterates the properties, keeps required
  non-optional ones with a value declaration, and tries each as a variance
  struct.
- `StrictEffectType` adds one name check: the type's symbol must be spelled
  `Effect`. That is what separates `Effect` from `Stream`, `Layer`, and
  `HttpApp.Default`, which carry the same variance struct.
- `EffectSubtype` (`Exit`, `Option`, `Either`, `Pool`) is the same marker plus a
  `_tag` or `get` property. `FiberType` is the marker plus `await` and `poll`.

The name check is the fallback, not the mechanism. The mechanism is a structural
marker that survives a rename and cannot be forged by text.

### From a node to the module that declares it

`internal/typeparser/module_export_reference.go` answers "is this identifier the
`Effect` that comes from the `effect` package?". It is worth reading in full
because it is the piece a text index cannot copy:

- `ReferenceSymbolAtNode` gets the symbol, falls back to the property name for a
  property access, resolves aliases, and for a non-declaration identifier follows
  a chain of `const x = y` aliases to the original symbol.
- `IsSourceFileInPackage` reads the source file's `package.json` `name`.
- `IsNodeReferenceToModuleExport` checks each declaration of the symbol, confirms
  it lives in the package, then compares the resolved export symbol with
  `Checker_getSymbolIfSameReference`. **Symbol identity, not string equality.**

### Derived facts, and how a rule reads them

`internal/typeparser/` also holds the higher-level derivations a rule actually
asks for: `expected_and_real_type.go`, `execution_flow.go`, `piping_flow.go`,
`identity_forwarder.go`, `layer_type.go`, `schema_type.go`, `effect_fn.go`.

A rule is small because the parser carries the weight. `internal/rules/floating_effect.go`:

```go
t := tp.GetTypeAtLocation(expr)
if t == nil { return nil }
if tp.HasEffectTypeId(t) {
    if !tp.IsEffectType(t) { return nil }
    if tp.IsFiberType(t) { return nil }
    if tp.IsEffectSubtype(t) { return nil }
} else if tp.StreamType(t) == nil { return nil }
isStrict := tp.StrictIsEffectType(t)
```

The rule is a sequence of typed predicates over a checker type. `internal/rule/rule.go`
declares the shape: `Name`, `Group`, `DefaultSeverity`, `Codes`, and
`Run(ctx *Context) []*ast.Diagnostic`. `internal/rulerunner/diagnostics.go`
builds the `TypeParser` once per run and hands it to every rule.

### How a non-Go host gets the same facts

Effect needs Oxlint (Rust) and editors to see the same diagnostics. Two paths:

- `etsoxlintrunner/runner.go` exposes `RunRule` and a runner-neutral
  `ReportedDiagnostic`, so a foreign host drives one rule and gets ranges,
  messages, edits and related information back.
- `_patches/tsgolint/001-effect-rules.patch` appends the Effect rules to the
  tsgolint rule table, and `_patches/oxlint/001-effect-plugin.patch` preserves
  the `effecttsgo/*` rule identities across the tsgolint protocol.

So the integration surface is: **someone runs the checker and returns facts or
diagnostics; the host never sees a checker type.** That is also the shape joggle
needs, whether the fact source is a sidecar, a trace, or a fork.

## What transfers to joggle, and what does not

Transfers:

- The facade + negative-cache design. joggle already bounds its work; a
  `TypeFacts` cache keyed by declaration belongs beside `parsecache.ts`.
- Marker-based identity: a well-known type is found by a property it must have,
  with the name as a secondary check. This is directly reusable for
  "is this a branded primitive", "is this an error channel", "is this a
  discriminated union", "is this a class extending X".
- Symbol-to-origin resolution through the checker, which is strictly stronger
  than joggle's `resolveRef` because it follows aliases and re-exports.
- Structural fingerprinting of a resolved type (member-sorted `name:type`),
  which is the same idea as entropy-machine's `structural_fp` and as joggle's
  `shapeHash` but over the **type** instead of the AST.
- The evidence-panel discipline: send the facts a reviewer needs, bounded.

Does not transfer directly:

- Effect runs in Go inside the compiler. joggle is a Node/TypeScript program
  over `oxc-parser` and a tsgo subprocess. joggle cannot import the shims.
- The Effect rules themselves are Effect-specific. `floatingEffect` knows what
  an `Effect` is because the variance struct says so. joggle has no such
  well-known type; it must recognise *the repository's own* concepts, which is
  exactly what the judged rules are for.

## Routes to the facts, by cost

| Route | What it gives | Cost |
| --- | --- | --- |
| `tsgo --generateTrace` | The full type graph as JSON; read-only, no fork | The declaration-to-resolved-type join is awkward: aliases expand, one name is several entries, and some names (JOGGLE.md's `CompanyType`) do not appear under their own name. Trace size is large (301MB for 1,870 files) |
| Entropy-machine's tsgolint patch | Exactly the wanted facts: `resolved_type`, `declared_type`, `structural_fp`, `passthrough`, `verified_identical` | A maintained Go fork of tsgolint and the TypeScript-Go port, plus a build step |
| `@effect/tsgo` binary | Effect diagnostics only, not general type facts | Gives rules, not a fact protocol; still a fork to keep current |
| Own checker host, modelled on Effect | A JSON protocol of the facts joggle wants, controlled by joggle | The largest build: shim generation, a patch stack, a Go or Rust sidecar, a protocol. This is the "eventual host" JOGGLE.md names |
| LSP hover/type-definition per node | Types one node at a time | No cross-file bulk, too slow for 1,870 files |

The honest order is: start with the trace, because it needs no fork, and let the
join problem decide whether a host is worth building. JOGGLE.md already says
this. Effect's contribution is the **specification** for what the host should
return when the join is not enough.

## The state to send to TypeSafe

Add one `typeFacts` object per declaration to `baseEvidence`, and carry the same
object on `Unit` so deterministic rules can use it. A bounded proposal:

```ts
interface TypeFacts {
  /** The checker's own printed type, the canonical form. */
  resolved: string
  /** The annotation as written, so declared-vs-resolved is visible. */
  declared: string | null
  /** Member-sorted `name:type` fingerprint of the resolved type. */
  structural: string
  /** Where the declaration lives: package, module, export name. */
  origin: { package: string | null; module: string; export: string }
  /** Named type arguments, in declaration order, as printed types. */
  parameters: ReadonlyArray<{ name: string; type: string }>
  /** A proven-identical group id across files, when the checker proves it. */
  identicalGroup: string | null
  /** True when the body only returns its callee's type unchanged. */
  passthrough: boolean
  /** The marker properties the checker found: brands, `_tag`, variance. */
  markers: ReadonlyArray<string>
}
```

The panel rule stays what it is: send what a reviewer needs and nothing more.
The change is that "declared type" becomes "declared type **and** what the
compiler says it resolves to". A model that can see
`declared: User`, `resolved: { id: string; email: string }` across two files is
answering a different question from one that sees two identical `source` blocks.

## Rules this unlocks

Each is deterministic, or deterministic-with-a-judge, and each is unreachable
from text.

- **`joggle/one-concept-one-type`** — one declared name that resolves to
  different shapes in different files. JOGGLE.md measures the case: `User`, 46
  resolved entries, 3 shapes, 4 of them `any`.
- **`joggle/declared-resolved-drift`** — the annotation promises a type the
  checker does not enforce (`any`, `unknown`, or a wider type). entropy-machine
  caught `addTodo: void` where the DB said `Todo`.
- **`joggle/structural-collapse`** — two differently named declarations the
  checker proves structurally identical (`Checker_isTypeIdenticalTo`). This is a
  **fact**, so it reports without a judgement; the judge then answers only "one
  concept or two names", which is the question JOGGLE.md says the judge is for.
- **`joggle/opaque-primitive`** — a `string`/`number` parameter where a branded
  domain type of that meaning already exists and is not used. Extends
  `name-the-primitive` from a name check to a type check.
- **`joggle/passthrough-chain`** — functions that return a callee's type
  unchanged, and the ratio of identity passthrough in a namespace. entropy-machine
  computed this; it is a strong candidate for a general rule.
- **`joggle/untyped-channel`** — a union or a generic whose channel argument
  resolves to `any`/`unknown` where a tagged error type is expected. This
  generalises Effect's `anyUnknownInErrorContext` and the codebase's own error
  ADTs.
- **`joggle/impossible-state`** — a discriminated union whose discriminant and
  payload can disagree. Needs resolved literal types.
- **`joggle/leaked-type`** — a public return type that names an implementation
  type instead of the declared interface, decided from resolved origin.

The first three are the priority: they are the ones JOGGLE.md already promises,
and they replace text similarity with a proof.

## The next increment: measured, and it is not the trace

The plan above (`docs/type-resolution.md`'s first draft of this section) said to
extract object members from the trace and replace `field-type-drift`'s text
resolver with them. **That plan is wrong, and it is wrong for a measured reason.**
Three probes against `tsgo 7.0.0-dev.20260707.2`, in `T/trace-probe*`:

1. `export interface PersonSummary { treesPlanted: Count; name: string }` has a
   trace entry with `flags: ["Object"]`, a `symbolName`, and **no `display` and no
   property list**. Only anonymous object types print their members:
   `__object @ { treesPlanted: Count; name: string }` appears for a literal, not
   for the interface. So a named type's fields are not in the trace.
2. `type ProjectRole = (typeof PROJECT_ROLES)[number]` and
   `type ProjectCrewRole = Schema["_output"]["type"]` produced **no entry
   attributed to either name** — the alias declarations are absent entirely.
3. `trace.json` is performance events only (`createSourceFile`, `checkSourceFile`,
   ...); it contains neither `PersonSummary` nor any member name. There is no
   second place to look.

So the fact `field-type-drift` needs is a **member** type, and the trace carries
declaration types only, and not even those for an alias. The trace route is
exhausted. `resolveType` in the rule therefore stays, still frozen, as the
stopgap it is.

### What actually does the job, by cost

| Route | Field-level resolved type? | Cost |
| --- | --- | --- |
| `--generateTrace` (current) | **No** — no members, no alias entries | free, already wired |
| tsgo LSP / query | **No** — `tsgo --help --all` has no `--lsp`, `--server` or query flag | unavailable |
| JS `typescript` program | Yes: `getTypeOfSymbolAtLocation(prop)` + `isTypeAssignableTo` | A second checker beside tsgo, a ~20MB dependency, and a whole-program create for a rule that today runs free. The decision to add it is the user's, not the rule's |
| Own checker host (Effect's shape) | Yes, and the protocol is controlled | The largest build: a maintained fork or sidecar, the "eventual host" |

### The cheaper route, tried and disproved

The recommendation above was to turn the surviving candidates into a `Choice`
("one concept, or two?"). It was built and measured, and **it made the rule
worse**. Reverted; the numbers are the reason.

The design: `field-type-drift` became a `PlannedRule`. The deterministic pass kept
`canCompose` as the candidate filter (176 field names on `shakti-v2`), and each
candidate got one `Choice` with three options -- `same_type`, `drift`,
`two_concepts` -- over the two declarations' names, paths and annotations.

The result, on the whole repository:

| | candidates | findings | `projectRole`/`ProjectCrewRoles` |
| --- | --- | --- | --- |
| deterministic + resolver (current) | -- | 102 | reported, warn |
| judged with the concept question | 176 | **150** | reported, **warn** |
| ... of the 176 | | 150 `drift`, 25 `two_concepts`, 1 gated | |

So the model answered **"one concept" 85% of the time**. That is not a
calibration problem; it is a state problem, and it is circular: `ProjectRole` and
`ProjectCrewRoles` are two vocabularies, and telling them apart means comparing
their **values** -- which is exactly the resolved type the trace does not carry,
and which was the whole reason this note exists. Asked "do these mean the same
thing?" with no values in the state, the model does what anyone would: it reads
`projectRole` twice and says yes.

The lesson is the earlier one, twice over: a question cannot recover a fact that
is missing from its state. `same_type` could never be answered either, because
one indexed access and one alias look identical to a model that cannot resolve
them.

### What is left

- **Relatedness was implemented and kept.** A shared field name is a hazard only
  when a value can move between the two declarations, which is decidable from the
  import graph: same file, same package, or one file directly importing the other.
  A cross test/application pair is not related, the same boundary the duplicate
  rules draw. On `shakti-v2`: 97 incompatible → **51 skipped, 74 findings** (was
  102), and every case from the feedback is gone -- `projectRole`/`ProjectCrewRoles`
  (UI constants vs the domain), `SiteSummary`/`RoleYearComparison`
  (manage-plots vs pay-review), `treesSupervised`/`RecordOptions` (application vs
  test). It also suppressed `estimate_tree_basis`, which nobody flagged; that is
  the accepted cost of a hazard test rather than an identity test.
- **The value sets, from the checker.** Still the only thing that separates two
  vocabularies that DO share a path -- two roles in one package, say. Needs a host
  (`getTypeAtLocation` per property), per the route table above.
- **Config.** `ignore` remains for a repository that knows a pair is expected.

The resolver stays either way: frozen, documented, and the least bad instrument
for the pairs relatedness keeps.





## Sources

- Host and hooks: `etscheckerhooks/init.go`, `etscheckerhooks/doc.go`.
- Facade and cache: `internal/typeparser/type_parser.go`.
- Safe checker access: `internal/typeparser/get_type_at_location.go`, `internal/typeparser/helpers.go`.
- Type identity: `internal/typeparser/effect_type.go`.
- Node to module: `internal/typeparser/module_export_reference.go`.
- Rule shape: `internal/rule/rule.go`; example rule `internal/rules/floating_effect.go`; runner `internal/rulerunner/diagnostics.go`.
- Checker state patch: `_patches/typescript-go/023-checker-effect-links.patch`.
- Foreign hosts: `etsoxlintrunner/runner.go`, `_patches/tsgolint/001-effect-rules.patch`, `_patches/oxlint/001-effect-plugin.patch`.
- README for the diagnostic surface and the superset claim: `README.md`, `AGENTS.md`.

## The node-type layer, as built

`src/typefacts.ts` is the smallest form of the own-checker-host route above, and
it needs no fork: `@typescript/native-preview` -- the `tsgo` binary joggle already
runs -- exposes `Checker.getTypeAtPosition(file, position)`. One program, a
lookup per position, and the checker's own printed type.

The join is the point. The declaration trace (`tsgo --generateTrace`) joins a NAME
to its resolved type, and the doc above records why that is awkward: aliases
expand, one name is several entries, some names never appear under their own name.
A node map joins by BYTE OFFSET, which both the checker and the oxc parser read
from the same file, so it is exact.

It is a REQUEST LIST rather than a whole-project dump, because the output for
1,870 files would be enormous and a rule only asks about the nodes its candidates
built. `check.ts` collects the positions in scope, asks once per run under
`--types`, and puts `RunContext.nodeTypes` on the context.

**What it answers, and what it does not.** `getTypeAtPosition` resolves the TOKEN
at a position -- hover, in effect -- so a binary expression's offset answers its
LEFT OPERAND (`payroll`, not the comparison that gives it a boolean). It answers
an IDENTIFIER's type, exactly, which is what `declared-resolved-drift` and
`opaque-primitive` need. It does NOT answer an expression's type. The declaration
trace does not either, for this purpose: it carries interfaces and aliases, not
function signatures.

To get expression types the next step is the native AST, not the position API:
`Program.getSourceFile` gives the checker's own tree, and
`Checker.getTypeAtLocation(returnStatement.expression)` is the exact answer --
`inferred-over-recorded` reads a comparison from the AST today for that reason.

Two rules now read types: `types-over-logic` reads `workspace.types` (a guard's
declared type), and the ones in "Rules this unlocks" are a candidate generator
plus a question each.
