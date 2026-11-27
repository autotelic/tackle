# Rules worth writing

We enforced these invariants by conversation for a day. A conversation is not a gate: the next session
will re-litigate every one of them unless a rule fails when it is broken. This list is ordered by one
criterion — **each rule either would have caught a defect that actually happened in this work, or encodes
a decision so it cannot be re-argued.**

Every rule names its negative fixture and its narrowing path, because a rule without those two becomes
exactly the false-positive generator we already met once (`reversal` firing on two
`Predicate.Predicate<string>` declarations that were never a duplicate).

---

## Tier 1 — rules that would have caught a defect that happened

### 1. `effect-test-cannot-float` (plumb)

In a test file that imports from `@effect/vitest`, a callback returning an Effect must be registered with
`it.effect` (or awaited). `test(name, () => effect)` builds the effect and throws it away.

```ts
// fires    test("adopts", () => story(...))
// passes   it.effect("adopts", () => story(...))
// passes   test("model is defined", () => expect(...))
```

**Caught:** the whole Move story suite reporting 4/4 green while `EvacuateBench` was hard-wired to reject
every call. Zero assertions executed, no output, no warning.

**Narrowing:** a genuinely synchronous test in an Effect file. The reason must say which value it
asserts, because “it does not return an effect” is exactly the case the rule exists to distinguish.

### 2. `rejection-has-a-story` (plumb)

Every exported `Domain.Rejection` subclass appears inside a `Story.rejected(...)` assertion somewhere in
the package's tests.

**Caught:** nothing yet — it encodes V3, “acceptance by refusal”. A rejection with no story is a refusal
nobody has seen fail, which is the state the Move suite was in for its whole life.

**Narrowing:** a rejection reachable only through another aggregate's command, named with the test that
exercises it instead.

### 3. `domain-purity` (plumb, allowlist per package)

A package that declares itself a domain may import only `effect`, `@alchemy.run/domain` and its own files,
and may not reference `Date.now`, `new Date`, `process.env`, `fetch(`, `node:fs` or `node:child_process`.

**Caught:** `alchemy` sitting in a domain package's `dependencies` while nothing imported it; `Date.now`
inside the turn encoder; and it is the rule that would have caught `Worktree` moving into `room/src`
_before_ “the CLI is the only I/O edge” became false.

**Narrowing:** none. This is the one rule whose absence makes every later claim (“the domain is pure”)
unfalsifiable, so the answer to a violation is a port, not a disable.

### 4. `no-caller-supplied-instant` (plumb)

A `Domain.Command` input may not carry `at`, `now`, `timestamp` or `occurredAt` when the `decide`
signature already receives `{ now }`.

**Caught:** `PauseRoom`/`ResumeRoom` accepting `at` from the caller while `CreateRoom` read the clock —
two time sources in one aggregate, and an operator could stamp a pause before the create.

**Narrowing:** a command that genuinely back-dates an external fact, with the reason naming that fact's
source of truth.

### 5. `baseline-entries-carry-a-reason` (plumb + lexicon)

A baseline entry is a record with `identity`, `reason` and `acceptedAt` — not a bare string.

**Caught:** nothing yet. It prevents the step we came within one command of taking all day: accepting a
finding by appending a string to a JSON array, with no sentence explaining why.

**Note:** the baseline is 48 bare identity strings today, so this is a `.jig-baseline.json` shape change
and a migration — a decision, not part of a conformance sweep.
---

## Tier 2 — rules that encode a decision so it cannot be re-argued

### 6. `no-local-noun-on-the-wire` (plumb)

No NSID, `$type` string or record property name may contain `bench`, `vise`, `shop`, `kit`, `room` or
`board`. Encodes D3.

This is the rule that keeps “a second vocabulary” from reappearing in six months, when somebody writes
`dev.autotelic.room.session` because it reads better in a diagram.

### 7. `exit-code-from-the-shared-table` (plumb)

No numeric literal in `process.exit(N)` or `process.exitCode = N`; the value comes from one imported
`EXIT` table.

Encodes “the door maps nothing”. Three constants that agree today are three that disagree after the next
feature, and a door that translates exit codes is a second implementation of the error model.

### 8. `hash-carries-its-encoding` (plumb)

A persisted hash names its encoding: `sha256:jsonl.v1:…`, later `cid:drisl.v1:…`.

Encodes the `journal.sha` decision, and makes the JSON→CBOR migration a visible rename rather than a
silent change in what a continuation token means.

### 9. `waiver-has-an-expiry` (plumb)

A type or record with a `reason` field must carry `expiresAt`, `reviewAt` or `until`.

Encodes “a waiver without an expiry is permission by inattention”. Applies to the pin exception, the
ignore list, and anything else with a why and no when.

### 10. `wire-error-names-are-verbatim` (plumb)

Every error name our XRPC surface can return appears in the pinned lexicon set.

Encodes “the error name _is_ the client's retry policy”: a renamed error is a client that retries forever
or never.

### 11. `observation-cites-its-bytes` (plumb, schema shape)

An `Observed` record without `records: string[]` — the CIDs it read — is invalid.

Encodes “observed at T” as a claim about bytes rather than about the world; without it a stale mirror
looks identical to a fresh read.

### 12. `generation-is-anchored` (plumb, shape)

A field named `generation` may appear unqualified only in a record that also carries `leaseId`; otherwise it
must be named `leaseGenerationHint` and accompanied by `leaseAuthority`.

Encodes the correction that came out of the observability work: **a generation without its lease is a hint, a
generation with its lease is a grant.** Without the rule, either direction rots — a span that says `…Hint`
throws away a fact the command genuinely carried, and a presence file that says `generation` invites a
takeover on something nobody granted.

**Narrowing:** a record whose `generation` is not a lease generation (a schema version, a retry counter),
with the reason saying which counter it is. The rule keys on the word, so the narrowing is how we say “this
one is a different noun”.

### 13. `no-cast-to-a-brand` (plumb, type-aware)

A type assertion whose target is a branded or nominally-private type is an error, and **no `SAFETY:` comment
justifies it.**

A brand exists to be un-forgeable: `Grant`, `Hint`, `LeaseId`, a TID. Every one of them earns its keep by
making an invalid value unrepresentable, and `as Grant` is the single line that undoes that. Elsewhere in
this repo an assertion with a written invariant is acceptable — that is what
`require-safety-comment-for-type-assertion` is for. A brand is the exception, because there is no invariant
to state: its whole meaning is “this came through the constructor.”

Three paths are legitimate, and none of them is an assertion:

```ts
const a = RoomId.make(value) // the constructor
const b = Schema.decodeUnknownSync(RoomId)(value) // decode through the type's own schema
const c = yield * parseAtBoundary(RoomId, input) // a parse where untrusted bytes enter

value as RoomId // fires
```

**Fixture, both ways:** `value as RoomId` fires; `Schema.decodeUnknownSync(RoomId)(value)` passes;
`RoomId.make(value)` passes. Three fixtures, because a rule with only a negative fixture cannot tell a
bypass from a sanctioned path.

**Narrowing:** none by design. If a value needs a brand and has no sanctioned path, the answer is a
constructor or a schema — not a comment.

---

## Tier 3 — joggle questions, not mechanics

Cheap to ask, expensive to mechanize, which is exactly the judgment layer:

- **“Would this test still pass if the feature were removed?”** The tautology detector; the Move suite is
  the case study.
- **“Is this a second implementation of an existing surface?”** `jig room` vs `room`; `toMcp` vs `toCli`; a
  renderer inside an editor extension.
- **“Does this decoder preserve fields it does not know?”** Forward compatibility is a property of the
  format, not a courtesy of the parser.
- **“Can this state be left?”** A state machine where no command is legal is a trap; `Divergent` has no
  resolution verb, so the only recovery is outside the model.
- **“Is the denominator in the sentence?”** Adoption rates, calibration, coverage. A percentage without a
  population is an opinion.
- **“What does this number mean when nothing was looked at?”** A quiet report and an unrun engine render
  identically unless something forbids it.

---

## Rules we should not write

- **Shape equality across packages.** We met it: `isTid` and `isTestPath` are both
  `Predicate.Predicate<string>` — a shared _type_, not a shared _shape_. We narrowed it twice and refused
  to add a helper to `protocol` for it.
- **“Is this the same idea as that one?” across packages.** A judgment call with no fixture, which is how
  a linter becomes a style guide with a build failure.
- **“The model is well designed.”** Not a rule, not measurable, not ours to assert in CI.

---

## The meta-rule

Every new rule ships with four things:

1. a **negative fixture** — input where it must fire;
2. a **positive fixture** — input where it must not;
3. a **named narrowing path**, and what a narrowing is allowed to say;
4. one sentence of docs saying **which defect it exists to catch**.

A rule without a negative fixture is a rule nobody has seen work — the same category of unknowledge as a
test that cannot fail, and that has surprised us twice today.

**Follow-up, measured:** re-enabling `guarded-op-must-return-option` now costs **17 findings** in
joggle alone — every `T | undefined` return it now flags in favour of `Either`. The rule pair is
coherent again (plumb `e402fd3f`), so the disable can be retired the moment those 17 sites move.
Until then the config says so in one sentence, which is the honest state: a hole with a named
price, not a shrug.
