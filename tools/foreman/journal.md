# Foreman journal

> Standing orders: [`FOREMAN.md`](../FOREMAN.md). This file is the checkpoint. A plain
> session's only durable memory is the repository, so the journal is written before a round
> ends or the budget yields — never after. Raw instrument captures live beside it under
> `tools/foreman/rounds/`.

---

# Round 1 — Phase A: build the system

**Opened:** 2026-10-16. **Phase:** A (§11): _the workspace root dogfood-configured for
`plumb` and `joggle` through `jig`, every engine running, findings accepted into a root
baseline._

## Altitude goal of the round

Make `pnpm jig check` at the workspace root a **real gate**: it must run `plumb`, `joggle`,
and `cutlist` against this repository, report honestly (a missing engine is a note, never
"clean"), and accept what it finds into a root `.jig-baseline.json` by identity.

The outcome, not the findings: after Round 1 the root is a live specimen the tools can see,
and the ratchet (`plumb` and `joggle` rules to `error`, baseline to empty) has somewhere to
stand. Everything below is scoped to that. From Round 2 the goal is Phase B, the ratchet.

## Budget

Committed as `tools/foreman/budget.json`; every dispatch checks it. Set by the foreman and
**provisional pending a human ceiling** (§9: "a budget is a document, not a feeling").

```json
{
  "window": "round-1",
  "ceilingTokens": 4000000,
  "ceilingUsd": 3.0,
  "spent": { "tokens": 1152369, "usd": 0.402013278, "at": "2026-10-16 census" },
  "concurrency": 2,
  "pausedUntil": null,
  "note": "Provisional; the foreman set it pending a human ceiling. Two ways to the one model: opencode-go/deepseek-v4.1-flash then the free line. Cap concurrency at 2; raise only on meter headroom. Census spend is the account to date, not the round."
}
```

---

## 1. Census (raw, unsummarized)

Every instrument in §4, run in order this round. Raw output only — the summary is where the
lie enters, so it comes after, in triage.

### 1.1 `pnpm jig engines` (root)

```
$ pnpm jig engines

$ node --conditions=development packages/jig-cli/src/cli.ts engines
engine              kind            command        on PATH
cutlist             process         cutlist        no
plumb               oxlint-plugin   oxlint         yes
joggle              process         joggle         yes

exit=0
```

### 1.2 `pnpm jig engines --cwd examples/self`

```
$ pnpm jig engines --cwd examples/self

$ node --conditions=development packages/jig-cli/src/cli.ts engines --cwd examples/self
engine              kind            command        on PATH
plumb               oxlint-plugin   oxlint         yes
joggle              process         joggle         yes
cutlist             process         cutlist        no

exit=0
```

### 1.3 `pnpm jig check --format json` (root — the ledger)

```
$ pnpm jig check --format json

$ node --conditions=development packages/jig-cli/src/cli.ts check --format json
{
  "lexicon": {
    "name": "report",
    "version": 1
  },
  "counts": {
    "error": 0,
    "warn": 0,
    "info": 2
  },
  "files": 2,
  "diagnostics": [
    {
      "engine": "joggle",
      "ruleId": "joggle/unparsed-output",
      "severity": "info",
      "message": "jig could not parse joggle output (exit 1)",
      "help": "readFileString: NotFound: FileSystem.readFile (/Users/togmund/autotelic/tackle/tsc app.ts util.ts)",
      "location": {
        "file": "joggle.config",
        "line": 1,
        "column": 1
      }
    },
    {
      "engine": "plumb",
      "ruleId": "plumb/unparsed-output",
      "severity": "info",
      "message": "jig could not parse plumb output (exit 1)",
      "help": "Failed to build configuration from /Users/togmund/autotelic/tackle/examples/self/.oxlintrc.json.\n\n  x Failed to load JS plugin: @autotelic/plumb/ui\n  |   \"./ui\" is not exported under the conditions [\"module-sync\", \"node\", \"import\"] from package /Users/togmund/autotelic/tackle/node_modules/.pnpm/node_modules/@autotelic/plumb (see exports field in /Users/togmund/autotelic/tackle/node_modules/.pnpm/n",
      "location": {
        "file": "plumb.config",
        "line": 1,
        "column": 1
      }
    }
  ],
  "generators": [
    {
      "id": "cutlist",
      "diagnostics": 0,
      "error": 0,
      "warn": 0,
      "info": 0,
      "durationMs": 3,
      "note": "cutlist could not run: NotFound: ChildProcess.spawn (cutlist build --check)"
    },
    {
      "id": "plumb",
      "diagnostics": 1,
      "error": 0,
      "warn": 0,
      "info": 1,
      "durationMs": 168
    },
    {
      "id": "joggle",
      "diagnostics": 1,
      "error": 0,
      "warn": 0,
      "info": 1,
      "durationMs": 1202
    }
  ],
  "elapsedMs": 1202
}
[ELIFECYCLE] Command failed with exit code 1.

exit=0
```

### 1.4 `pnpm jig check --cwd examples/self` (the exemplar's own gate)

```
$ pnpm jig check --cwd examples/self

$ node --conditions=development packages/jig-cli/src/cli.ts check --cwd examples/self
0 error(s), 0 warning(s), 2 notice(s) in 2 file(s)

engines
  plumb: 1 finding(s)
  joggle: 1 finding(s)
  cutlist: 0 finding(s) — cutlist could not run: NotFound: ChildProcess.spawn (cutlist build --check)

ratchet
  joggle/joggle/unparsed-output: 1 new finding not in the baseline
  plumb/plumb/unparsed-output: 1 new finding not in the baseline
[ELIFECYCLE] Command failed with exit code 1.

exit=0
```

### 1.5 `doppler run -p joggle -c dev -- pnpm jig check` (judged)

The judged census is the same ledger with the judged rules live. It re-runs the same engines,
so it fails for the same two reasons; no judged rule could fire because the engines they ride
never started.

```
$ doppler run -p joggle -c dev -- pnpm jig check

$ node --conditions=development packages/jig-cli/src/cli.ts check
0 error(s), 0 warning(s), 2 notice(s) in 2 file(s)

engines
  cutlist: 0 finding(s) — cutlist could not run: NotFound: ChildProcess.spawn (cutlist build --check)
  plumb: 1 finding(s)
  joggle: 1 finding(s)

ratchet
  joggle/joggle/unparsed-output: 1 new finding not in the baseline
  plumb/plumb/unparsed-output: 1 new finding not in the baseline
[ELIFECYCLE] Command failed with exit code 1.

exit=0
```

### 1.6 `pnpm cutlist build --check --cwd examples/self` (staleness)

```
$ pnpm cutlist build --check --cwd examples/self

$ node --conditions=development packages/cutlist/src/cli.ts build --check --cwd examples/self
tools/ui-catalog/catalog.json is up to date (5aad97ef1237)

exit=0
```

### 1.7 Gates — root `pnpm check`

```
$ pnpm check

$ pnpm format:check && pnpm typecheck && pnpm test && pnpm lexicon:compat && pnpm build
$ oxfmt --check .
Checking formatting...


  x Expected `,` or `)` but found `Identifier`
   ,-[tools/foreman/rounds/round-1/census-meter.json:1:3]
 1 | $ opencode2 stats --json --full --project .
   : ^ ^^^^|^^^^
   : |     `-- `,` or `)` expected
   : `-- Opened here
 2 |
   `----

  x Expected `,` or `)` but found `Identifier`
   ,-[tools/foreman/rounds/round-1/census-ledger-root.json:1:3]
 1 | $ pnpm jig check --format json
   : ^ ^^|^
   : |   `-- `,` or `)` expected
   : `-- Opened here
 2 |
   `----
Error occurred when checking code style in the above files.
[ELIFECYCLE] Command failed with exit code 2.
[ELIFECYCLE] Command failed with exit code 2.

exit=0
```

### 1.8 Gates — `packages/plumb` own `check`

```
$ cd packages/plumb && pnpm check

$ pnpm lint && pnpm typecheck && pnpm test && pnpm check:rule-tests && pnpm check:config
$ oxlint src
$ tsc --noEmit
$ vitest run --passWithNoTests

 RUN  v4.1.12 /Users/togmund/autotelic/tackle/packages/plumb


 Test Files  12 passed (12)
      Tests  85 passed (85)
   Start at  16:46:02
   Duration  1.73s (transform 1.14s, setup 0ms, import 4.29s, tests 490ms, environment 1ms)

$ node scripts/check-rule-tests.mjs
missing suite: rules/no-anonymous-wide-tuples.test.ts
missing suite: rules/no-barrel-export-star.test.ts
missing suite: rules/no-boolean-field-signals.test.ts
missing suite: rules/no-builtin-throws.test.ts
missing suite: rules/no-chained-type-assertions.test.ts
missing suite: rules/no-conditional-empty-object-spread.test.ts
missing suite: rules/no-exported-mutable-state.test.ts
missing suite: rules/no-generic-export-names.test.ts
missing suite: rules/no-impossible-branch-throw.test.ts
missing suite: rules/no-known-value-widening.test.ts
missing suite: rules/no-module-mocking.test.ts
missing suite: rules/no-multiple-function-params.test.ts
missing suite: rules/no-nondeterministic-core.test.ts
missing suite: rules/no-object-parameters.test.ts
missing suite: rules/no-optional-function-parameters.test.ts
missing suite: rules/no-product-of-state-booleans.test.ts
missing suite: rules/no-redundant-derived-field.test.ts
missing suite: rules/no-reflect-apply.test.ts
missing suite: rules/no-reflect-get.test.ts
missing suite: rules/no-reinterpret-cast.test.ts
missing suite: rules/no-runtime-typeof.test.ts
missing suite: rules/no-sentinel-comparison-union.test.ts
missing suite: rules/no-shape-in-symbol-names.test.ts
missing suite: rules/no-stacked-jsdoc-blocks.test.ts
missing suite: rules/no-stray-inline-comments.test.ts
missing suite: rules/no-swappable-primitive-params.test.ts
missing suite: rules/no-tag-ladder-assertions.test.ts
missing suite: rules/no-transposed-field-reads.test.ts
missing suite: rules/no-unit-return-validators.test.ts
missing suite: rules/no-unknown-parameters.test.ts
missing suite: rules/no-unknown-returns.test.ts
missing suite: rules/no-unknown-type-aliases.test.ts
missing suite: rules/no-unsafe-dictionary-type.test.ts
missing suite: rules/no-vague-test-filenames.test.ts
missing suite: rules/no-widen-then-assert.test.ts
missing suite: rules/prefer-payload-brand.test.ts
missing suite: rules/prefer-property-tests.test.ts
missing suite: rules/require-canonical-stringify-for-identity.test.ts
missing suite: rules/require-deprecated-tag-for-legacy-comments.test.ts
missing suite: rules/require-exhaustive-tag-switch.test.ts
missing suite: rules/require-fc-block-predicate.test.ts
missing suite: rules/require-jsdoc-on-exported.test.ts
missing suite: rules/require-published-order.test.ts
missing suite: rules/require-safety-comment-for-type-assertion.test.ts
missing suite: rules/require-sort-comparator.test.ts
missing suite: rules/test-utils.test.ts
missing suite: effect/rules/guarded-op-must-return-effect.test.ts
missing suite: effect/rules/guarded-op-must-return-option.test.ts
missing suite: effect/rules/no-cascading-layer-provide.test.ts
missing suite: effect/rules/no-decode-unknown-option.test.ts
missing suite: effect/rules/no-direct-browser-storage.test.ts
missing suite: effect/rules/no-direct-fetch.test.ts
missing suite: effect/rules/no-manual-field-guards.test.ts
missing suite: effect/rules/no-nested-layer-provide.test.ts
missing suite: effect/rules/no-schema-class-modeling.test.ts
missing suite: effect/rules/no-service-constructor-imports.test.ts
missing suite: effect/rules/no-silent-error-swallow.test.ts
missing suite: effect/rules/no-static-effect-service-forwarders.test.ts
missing suite: effect/rules/no-try-catch.test.ts
missing suite: effect/rules/no-unguarded-json-parse.test.ts
missing suite: effect/rules/option-core-needs-effect-public.test.ts
missing suite: effect/rules/prefer-die-for-precondition-defects.test.ts
missing suite: effect/rules/prefer-effect-gen-for-guard-ladders.test.ts
missing suite: effect/rules/prefer-effect-match.test.ts
missing suite: effect/rules/prefer-effect-predicate-over-boolean-function.test.ts
missing suite: effect/rules/prefer-named-guard-predicate.test.ts
missing suite: effect/rules/prefer-option-pipeline.test.ts
missing suite: effect/rules/prefer-ordering-match.test.ts
missing suite: effect/rules/prefer-tagged-enum.test.ts
missing suite: effect/rules/require-schema-type-derivation.test.ts
missing suite: meta/rules/no-disable-directives.test.ts
missing suite: meta/rules/no-manual-ancestor-walks.test.ts
missing suite: meta/rules/prefer-before-file-scope.test.ts
missing suite: meta/rules/require-create-once.test.ts
missing suite: meta/rules/require-rule-tester.test.ts
75 rule(s) missing test suites.
$ node scripts/check-config.mjs
oxlint config consistent with shipped plugins.

exit=0
```

### 1.9 Gates — `packages/joggle` own `check`

```
$ cd packages/joggle && pnpm check

$ pnpm typecheck && pnpm test && pnpm lint
$ tsgo --noEmit
$ vitest run

 RUN  v5.0.1 /Users/togmund/autotelic/tackle/packages/joggle


 Test Files  68 passed (68)
      Tests  282 passed (282)
   Start at  16:45:58
   Duration  7.12s (import 77%, tests 16%, transform 7%)

    Isolate  68 workers spawned · ~106ms startup each (spawn + environment, per file)
             at least ~694ms faster with isolate: false — reuses workers across files instead of one per file

$ node scripts/lint-baseline.mjs

0 findings, 0 new, 0 fixed since the baseline.

exit=0
```

### 1.10 Types — `pnpm typecheck`

```
$ pnpm typecheck

$ pnpm -r run typecheck
Scope: 6 of 7 workspace projects
packages/protocol typecheck$ tsgo --noEmit
packages/plumb typecheck$ tsc --noEmit
packages/protocol typecheck: Done
packages/cutlist typecheck$ tsgo --noEmit
packages/jig-cli typecheck$ tsgo --noEmit
packages/cutlist typecheck: Done
packages/jig-cli typecheck: Done
packages/plumb typecheck: Done
packages/joggle typecheck$ tsgo --noEmit
packages/joggle typecheck: Done

exit=0
```

### 1.11 Formats — `pnpm lexicon:compat`

```
$ pnpm lexicon:compat

$ pnpm --filter @autotelic/protocol lexicon:compat
$ node scripts/lexicon-compat.mjs
lexicon-compat: 8 frozen record(s) valid against the current schemas

exit=0
```

### 1.12 Meter — `opencode2 stats --json --full --project .`

```
$ opencode2 stats --json --full --project .

{
  "range": {
    "from": 1767254400000,
    "to": 1792194339183
  },
  "sessions": 4,
  "subagents": 2,
  "prompts": 12,
  "steps": 284,
  "tokens": {
    "input": 880810,
    "output": 128171,
    "reasoning": 143388,
    "cache": {
      "read": 35652126,
      "write": 0
    }
  },
  "cost": 0.402013278,
  "tools": {
    "mode": "detail",
    "totals": {
      "calls": 509,
      "succeeded": 503,
      "failed": 5,
      "unfinished": 1
    },
    "usage": [
      {
        "name": "read",
        "calls": 218,
        "succeeded": 218,
        "failed": 0,
        "unfinished": 0,
        "durationP50": 16.5
      },
      {
        "name": "shell",
        "calls": 124,
        "succeeded": 123,
        "failed": 0,
        "unfinished": 1,
        "durationP50": 119
      },
      {
        "name": "edit",
        "calls": 60,
        "succeeded": 57,
        "failed": 3,
        "unfinished": 0,
        "durationP50": 11
      },
      {
        "name": "write",
        "calls": 55,
        "succeeded": 55,
        "failed": 0,
        "unfinished": 0,
        "durationP50": 7
      },
      {
        "name": "glob",
        "calls": 20,
        "succeeded": 20,
        "failed": 0,
        "unfinished": 0,
        "durationP50": 28
      },
      {
        "name": "grep",
        "calls": 14,
        "succeeded": 14,
        "failed": 0,
        "unfinished": 0,
        "durationP50": 31
      },
      {
        "name": "webfetch",
        "calls": 11,
        "succeeded": 9,
        "failed": 2,
        "unfinished": 0,
        "durationP50": 833
      },
      {
        "name": "question",
        "calls": 3,
        "succeeded": 3,
        "failed": 0,
        "unfinished": 0,
        "durationP50": 29725
      },
      {
        "name": "subagent",
        "calls": 2,
        "succeeded": 2,
        "failed": 0,
        "unfinished": 0,
        "durationP50": 84425
      },
      {
        "name": "skill",
        "calls": 1,
        "succeeded": 1,
        "failed": 0,
        "unfinished": 0,
        "durationP50": 9
      },
      {
        "name": "execute",
        "calls": 1,
        "succeeded": 1,
        "failed": 0,
        "unfinished": 0,
        "durationP50": 29
      }
    ]
  },
  "activeDays": 1,
  "streak": 1,
  "activity": [
    {
      "date": "2026-10-16",
      "steps": 284
    }
  ],
  "models": [
    {
      "model": {
        "id": "deepseek-v4.1-flash",
        "providerID": "opencode-go",
        "variant": "default"
      },
      "steps": 284,
      "tokens": {
        "input": 880810,
        "output": 128171,
        "reasoning": 143388,
        "cache": {
          "read": 35652126,
          "write": 0
        }
      },
      "cost": 0.402013278
    }
  ]
}

exit=0
```

### 1.13 Ad hoc probes (the census that the census implies)

Run because the instruments above pointed at them; each is a primary source, not a summary.

`joggle` **resolves to a global binary, not the workspace source.** `which joggle` answers
`/Users/togmund/.local/bin/joggle`; `which cutlist` and `which jig` answer not-found. So the
"on PATH" column in 1.1/1.2 is an ambient fact about the caller's shell, not a fact about the
project — and the root run today may be driving a joggle the repository did not build.

```
$ which cutlist joggle jig oxlint
cutlist not found
/Users/togmund/.local/bin/joggle
jig not found
oxlint not found
```

**`joggle check` against its own package runs clean; against the root it never starts.** Same
binary, different `cwd`: at `packages/joggle` it reads that package's `tsconfig.json`; at the
root it synthesises TypeScript's default file list and dies. This isolates the cause to the
missing root project, not to joggle.

```
$ cd packages/joggle && node --conditions=development src/main.ts check --format json

{
  "diagnostics": [],
  "summary": {
    "files": 151,
    "rules": 38,
    "structure": {
      "concepts": 554,
      "declarations": 639,
      "duplicated": 114,
      "overloaded": 0
    },
    "problems": 0,
    "errors": 0,
    "warnings": 0,
    "infos": 0,
    "judged": 0,
    "byMove": {
      "contract": 0,
      "combine": 0,
      "expand": 0,
      "correctness": 0
    },
    "skipped": [
      {
        "ruleId": "joggle/hoist-to-domain",
        "reason": "joggle/Decision.systemOne: MissingKey: No API key provided. Set the appropriate environment variable. TYPESAFE_API_KEY is not set"
      }
    ],
    "notes": [
      {
        "ruleId": "joggle/layer-direction",
        "reason": "0 upward import(s) among 61 ranked file(s) in 5 declared layer(s); 90 file(s) in no layer"
      },
      {
        "ruleId": "joggle/layer-purity",
        "reason": "no layer declares a forbidden import, so there was nothing to check -- not the same as finding none"
      },
      {
        "ruleId": "joggle/import-cycle",
        "reason": "0 runtime cycle(s), 1 type-only, 3 partly erased, in 1051 import edge(s)"
exit=
```

---

## 2. Triage

Each finding gets one of joggle's three moves, assigned **after** the deeper-version question
(§8). The question's answer is written under each; it is a task-preprocessing step, not a
preamble.

### F1 — `cutlist` reported off PATH; engine resolution is ambient

**Evidence:** 1.1, 1.2, 1.13. **Move: contract** (delete the reliance on the caller's PATH).

> **Deeper version.** (1) A maintainer of these tools does not special-case `cutlist`; they
> make an engine's _location_ a fact of the project, because PATH is ambient and a global
> binary can shadow the workspace one — as `joggle` demonstrably does here. (2) The rawest
> material is the census itself, `process.env.PATH`, and `ls <root>/node_modules/.bin`. (3) The
> instrument is `jig engines` plus a unit test on the resolver; the regime is a **fact** from
> the filesystem, not a judgement. (4) The outside judge is `jig engines --cwd examples/self`
> answering `cutlist yes`, and `packages/jig-cli`'s own `vitest`.
>
> Task: `jig` resolves `<root>/node_modules/.bin/<command>` before PATH, and the census reports
> which it used.

### F2 — `joggle/unparsed-output` at the root: there is no project to read

**Evidence:** 1.3, 1.13. **Move: combine** (state the composition: root project + root types).

> **Deeper version.** (1) A maintainer adds a root `tsconfig.json` scoped to `packages/*/src`
> and pins `@types/node` at the root, because a root project resolves `types` from the root
> `node_modules`; per-package configs already do. (2) The rawest material is the engine's own
> error (`.../tackle/tsc app.ts util.ts`) and `tsconfig.base.json`'s `"types": ["node"]`. (3)
> The instrument is `jig check --format json`; the regime is a **fact** — the absence or
> presence of `joggle/unparsed-output`. (4) The judge is `jig check` and `pnpm typecheck`.
>
> Task: add the root project and the root `@types/node`.

### F3 — `plumb/unparsed-output` at the root: bare oxlint, and an unbuildable exemplar config

**Evidence:** 1.3. Two causes in one finding: (a) the root `oxlint.config.ts` has no `plumb`
plugin, so the plumb engine is oxlint wearing plumb's name (MIGRATION item 6); (b) oxlint scans
`examples/self/.oxlintrc.json`, which names `@autotelic/plumb/ui` (on the branch the move did
not take) and the external `@shadcn/lint`, and fails to _build a config_ before reading a file.

> **Deeper version.** (1) A maintainer wires `plumb` into the root `oxlint.config.ts` so the
> engine runs real rules, and scopes the run with `--ignore-pattern` (the CLI flag, because a
> root config's ignores do not stop oxlint building a directory's config) so the exemplar's
> unbuildable config is never built. (2) The rawest material is the failure text naming
> `.oxlintrc.json`, the file list of nested `oxlint.config.ts`, and the actual rule count a
> hand-run `oxlint --config` reports. (3) The instrument is a hand-run `oxlint` and then
> `jig check`; the regime is a **fact**. (4) The judge is `jig check` (plumb findings present,
> `plumb/unparsed-output` absent) and the gates.
>
> Task: wire the root `oxlint.config.ts`; give the `plumb` engine its `args` (F1's field).

### F4 — there is no root `jig.config.json`

**Evidence:** 1.3 ran the built-in default trio, not a committed statement. **Move: combine.**

> **Deeper version.** (1) A maintainer writes what runs as a committed fact naming all three
> engines, their configs, and the plumb engine's `args`. (2) Rawest material: `jig-cli`'s
> `defaultConfig` and the two census outputs. (3) `jig engines`; regime fact. (4) Judge:
> `jig engines` at the root lists all three; `jig check` drives them.
>
> Task: commit the root `jig.config.json`.

### F5 — the exemplar has no `.jig-baseline.json`, and its plumb engine cannot build

**Evidence:** 1.2, 1.4. **Move: contract** (accept by identity) — but **blocked**: the exemplar's
plumb engine still cannot load `@autotelic/plumb/ui`, so its plumb findings never arrive. Fix
the exemplar's baseline only for the engines that run; leave the `ui` blocker as a note, not a
finding. **Not this round** — the exemplar is a client, and this is its own item.

### F6 — `plumb`'s `check:rule-tests` reports 75 missing suites and exits 0

**Evidence:** 1.8. The script is advisory (`--strict` is the failure mode) and `plumb`'s
`check` does not pass it. **Move: expand** (a judgement: is a co-located suite required?).
**Queue, not this round** — it is a §7 design act with an approval, not a Phase A prerequisite.

### F7 — the changed-files gate §5 and MIGRATION name does not exist

**Evidence:** 1.7, and `grep` for `lint:errors:changed`/`.oxlint-errors.json` finds only the
exemplar's data file. §5's rung 2 ("Touched") and FOREMAN §4 both assume a
`pnpm lint:errors:changed` reading `.oxlint-errors.json`. Nothing in this repository implements
it. **Move: expand** (a missing primitive). **Learn queue** — this is the kind of gap the whole
machine exists to name.

### F8 — the root ledger runs before it can be trusted

**Evidence:** 1.1–1.4. **Move: contract.** The root and exemplar ledgers will be accepted only
_after_ F1–F4 make the engines honesty-visible. That ordering **is** Phase A.

---

## 3. Dispatch plan

One workstream, one worktree, one conversation. The model is the same for every member (§6);
differentiation is evidence and authority. This round the benches are **not** given a physical
`git worktree` — see the deviation note below — because a fresh worktree needs its own
`pnpm install` and the two benches touch disjoint file sets in one tree.

| #   | Workstream                                    | Move              | Files owned                                                                                                                 | Judge that accepts it                                                        | requestId                       |
| --- | --------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| W1  | Engine location + args (cartographer/combine) | contract + expand | `packages/protocol/{src,schema,fixtures}`, `packages/jig-cli/{src/config.ts,src/engines.ts,src/cli.ts,src/engines.test.ts}` | `packages/jig-cli` vitest; `jig engines --cwd examples/self` = `cutlist yes` | `foreman/r1-w1-engine-location` |
| W2  | Root dogfood config (foreman, trunk)          | combine           | root `tsconfig.json`, root `package.json`, root `oxlint.config.ts`, root `jig.config.json`                                  | `pnpm jig check`, `pnpm check`                                               | `foreman/r1-w2-root-config`     |
| W3  | Accept the root ledger                        | contract          | root `.jig-baseline.json`                                                                                                   | `jig check` after `jig baseline` exits 0                                     | `foreman/r1-w3-baseline`        |
| W4  | Witness (independent conversation)            | —                 | — (reads)                                                                                                                   | `jig check`, `pnpm check`, the two package `check`s                          | `foreman/r1-w4-witness`         |
| W5  | Red team (independent, never writes)          | —                 | — (reads)                                                                                                                   | primary sources only                                                         | `foreman/r1-w5-redteam`         |

**Expansion approval (recorded, §7).** W1 changes the `EngineRef` **format** by adding an
optional `args: string[]`. That is an `expand`: it grows the vocabulary every `jig` consumer
speaks. It is approved here because FOREMAN §11 mandates it ("plus the `EngineRef` `args` field
`jig`'s plumb engine needs") and because the evidence is that no existing field can scope an
engine's invocation — the `args` are fixed by `engines.ts`'s id map today. The outside judges
are `protocol`'s Ajv schema-conformance suite and `protocol`'s `lexicon:compat` (the addition
must not reject an old record).

**Deviation, recorded.** §10 asks one worktree per workstream. Round 1's benches work in the
trunk tree on disjoint files, because each fresh worktree pays a full `pnpm install` and the
two benches here are the root seam itself. The independence that matters for this round — the
witness and the red team — is bought with **separate conversations and raw instruments**, and
those members are dispatched as such. If a later round's benches touch overlapping files, they
get real worktrees.
