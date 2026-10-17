# Make `jig` the one command — a standing brief

> Hand this file to a session the way you hand it `FOREMAN.md`. It is self-contained.

## The outcome (hold this; do not work a task list)

A repository where a single **`jig check` — run by a person, by CI, by pi, or by OpenCode — is
the only thing anyone needs** to know what this repo enforces, what is new, what was _judged_
rather than _determined_, and what to do next; and where that one answer is trusted enough that
**nothing downstream re-derives or re-renders it.**

The chain of "what next": (1) `jig` prints a report a busy person or a fresh agent trusts;
(2) an agent reaches for `jig` without being told it exists; (3) the ratchet empties itself from
the report. Make the workflow durable, not a sequence of tasks.

## The invariant, applied to judgement

**"No findings" and "not looked at" must never look the same.** Applied to judgement: **an
unjudged candidate is "not judged", never "clean."** An engine that replayed a cache, skipped a
rule, or could not judge a candidate is _not_ a clean engine, and the report — machine and human
— must say which it was.

## Census first, from the rawest material

Before planning, run the engines and read **their own JSON**, not jig's report. Commit the raw
output; do not summarize first — the summary is where the lie enters.

- `joggle check --format json`: `summary.drops` (the candidate funnel), `summary.skipped`,
  `summary.notes`, and per-diagnostic `move`, `score`, `confidence`, `repair`, `judged`.
- `oxlint --format json` (and `--format sarif|gitlab|github`); the ten varieties under
  `packages/jig-cli/fixtures/oxlint/`.
- `packages/protocol/fixtures/` — the frozen corpus; `fixtures/projections/` is the only judge
  for the projections.
- The committed `packages/joggle/.joggle/answers/` shards; and the engines' exit codes and
  stderr, not only their stdout.

Record what the census proves. Expect it to prove the invariant is already violated at this
repository's root.

## The work — each with its outside judge

1. **Lossless report.** Carry joggle's provenance end to end: per-finding
   `judged`/`confidence`/`score`/`repair`/`move`, and per-engine a judgement **status**
   (`ran | replayed | skipped | errored`) plus the candidate funnel reduced to honest counts
   (`N not judged, by stage`). Add the missing fields to the `protocol` `Diagnostic` and
   `EngineSummary` as **optional fields** (the lexicon rule: additive only). A replayed engine
   must not read as a clean one. _Judge: `jig check --format json` matches
   `joggle check --format json` exactly, provenance included; `renderText` shows judged vs
   unjudged._

2. **The human report.** `renderText` prints counts and ratchet lines and no findings. Move the
   readable-findings quality out of `extensions/jig.ts` and into jig's renderer: findings list,
   `help`, `(unverified)` for judged-vs-static, engine notes that mean "could not run", and a
   bounded `shown N of M` that **never truncates the census or the next-action line**. On a
   clean tree, print honest silence ("nothing new · 3 engines · 2 replayed · 41 not judged"),
   never blank. _Judge: pi's and OpenCode's bytes equal `jig check`'s bytes._

3. **Close the read/write loop.** Implement the projections **in jig** —
   `--format sarif | jsonl | lsp | codeclimate | json | github | text` — matching
   `packages/protocol/docs/projections.md` and `fixtures/projections/*.golden.json`
   byte-for-byte: the 1-based→0-based LSP shift; the Code Climate fingerprint from `identity`,
   never line; baselines as novel/known annotations and suppressions. Round-trip: jig's SARIF
   must read back to the report modulo declared loss. _Judge: the protocol fixtures;
   properties for the shift and the fingerprint._

4. **Honor the config, or delete the knob.** `report.format`, `report.maxWarnings`,
   `gate.failOn` (`error|warn|any-new`), `gate.mode` (`touched-files|all`) are decoded and
   ignored, and `cli.ts` hardcodes the failure rule. Enforce them under a **documented
   exit-code contract** (0 clean; 1 findings; 2 usage/config; 3 engine infrastructure). Do not
   ship a knob that lies. _Judge: a config fixture per mode, and the exit-code contract under
   test._

5. **Every named command exists, or the docs stop naming it.** The root README advertises
   `jig explain/learn/promote`; `cli.ts` has `check/baseline/engines/init`. Implement real ones
   — `explain <engine/ruleId>` reading the report and rule metadata so `help` is a fix, not a
   restatement; `promote` computing the ratchet's next rung from the report (the ratchet
   emptying itself); `learn` scaffolding from what the repo already accepts — or remove the
   names. `jig init` must also write `ONBOARD.md`; `agent.onboarding` is in the schema and the
   exemplar.

6. **Both agent surfaces derive from the CLI.** No render and no analysis in either surface;
   resolve the open `typebox`/pi-types item (`MIGRATION.md` §6) rather than leaving the
   extension undeclared. Prove equality by running both surfaces against a temp repo. _Judge:
   byte-equality with the CLI, exercised end to end._

7. **The unreasonable goal.** Seed a defect in a scratch repo, baseline it, remove the baseline
   entry, and hand a **fresh agent with no context** nothing but jig's report. Measure whether
   it fixes the defect correctly on the first try. Report what you learned either way — the
   result is the point, not the claim.

   **Ran 2026-10-17.** A scratch repo (`/tmp/jig-experiment`) with one file and one engine,
   `plumb` over three house rules that need no type information:

   ```ts
   export const move = (from: string, to: string): string => `${from} -> ${to}`

   export const tag = (options?: { readonly label?: string }): string => options?.label ?? ""
   ```

   `jig check` reported four errors, `jig baseline` accepted three identities (same rule and
   file collapse to one identity — two `require-jsdoc-on-exported` findings share one), the
   entries were deleted, and the resulting report was handed verbatim to a fresh agent, along
   with the directory and three constraints: edit only there, change no config, add no
   suppression. **The first try was clean**: `jig check` exited 0, the diff touched
   `src/geometry.ts` alone, and no config or suppression changed. The agent branded the two
   adjacent `string` parameters (`type From = string & { readonly __brand: "From" }`), spelled
   `options: T | undefined` out, and wrote JSDoc with `@param`/`@returns` on both exports.

   What that measures, and what it does not: the fix for three of the four findings is
   idiomatic. The fourth is correct-as-asked and _incomplete as a fix_ — the brands have no
   constructor, so a caller would need an assertion to produce a `From`. The rule's own
   suggestion (`Brand.Brand`) would have supplied one, and `effect` was not resolvable in that
   repo, so the agent's hand-rolled brand was the best available under the constraints. Lesson
   worth keeping: when a rule's message names the remedy, the agent follows the message
   literally; a rule whose `help` names a _technique_ rather than a _result_ can be satisfied
   without finishing the job. The agent also had a working directory and shell, so this is
   "report plus the repo", not "report in a vacuum" — and it re-ran oxlint itself to confirm,
   which is the report being actionable rather than a second source of truth.

## Range — assemble the crew, and have each _do_ the verb

- **Compiler-diagnostics engineer**: dedup with a count, source-accurate spans, stable frozen
  codes, `--explain`.
- **CI/code-scanning maintainer**: SARIF round-trip validated against the schema, baselines as
  suppressions, exit codes as contract.
- **CLI designer**: `--help` that teaches, `NO_COLOR`, stdout = report / stderr = progress,
  honest silence on a clean tree.
- **Tooling-for-agents engineer**: tool descriptions as routing, output budgets that never
  truncate a verdict.
- **Red team / forensic accountant**: adversarially make jig report _clean_ when an engine never
  ran, or _new_ when a finding only moved. It reads; it never writes.

## The laws (this repo's house style)

No `jig → plumb/joggle/cutlist` import, ever — shell out; touch `protocol` only to add a format
field. Type-strippable TS (`erasableSyntaxOnly`), `.ts` import extensions, `tsgo`, `oxfmt` (no
semicolons, double quotes, 100 cols), comments that say _why_. Read defensively, write strictly:
a stale baseline degrades to silence, never to false findings. **Add a fixture test for every
new rule or renderer** — a generator's output is only as trustworthy as the pair it is checked
against. Stage explicit paths; preserve existing work.

## Acceptance (the outside judge)

From a clean tree:

```sh
pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm jig check                     # one report, honest census, ratchet holds
pnpm jig check --format sarif      # matches protocol's fixtures
pnpm jig check --format lsp        # and codeclimate, and jsonl
pnpm jig engines --cwd examples/self
```

plus **keyed evidence for each claim**: the engines' own JSON diffed against jig's report; the
protocol projection fixtures byte-equal; the two agent surfaces byte-equal with the CLI; and the
fresh-agent experiment's first-try result. Nothing is done until an outside judge says so —
never on your summary of your own work.

Stop only for approval, the budget, or an irreversible action.
