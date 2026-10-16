# joggle friction log

A chronological record. The rounds are in the order they happened and each says
what was true then; the rules, flags and thresholds it names have moved since, and
the current set is whatever `joggle rules` prints. It is kept because the *kind* of
thing that fights back is the useful part, not the state of any one round.

Running joggle against a real repository (`shakti-v2`, ~2,500 parsed files) from
a sibling checkout. Everything that fought back, with the reproduction and the
resolution, plus two suspicions that were disproved.

The session that produced this ran before the fixes below. Items marked
**fixed** changed in the same commit as this file; items marked **open** are
either by design or need a repository config.

## The commands that worked

```sh
cd /Users/togmund/autotelic/mess
pnpm joggle rules
pnpm joggle:elsewhere ../shakti-v2 --since origin/develop --offline
doppler run --project joggle --config dev -- pnpm joggle check \
  --cwd /Users/togmund/autotelic/shakti-v2 --pr-number 1568
doppler run --project joggle --config dev -- pnpm joggle ask \
  --cwd ../shakti-v2 "where are bonus rates applied?" services/rest/src/domain/pay-review
```

The judged layer works: findings come back with confidences, and a low-margin
answer is marked for review rather than asserted.

## Fixed

### 1. There is no `joggle` command

**Was:** `joggle@0.1.0` lived only inside the checkout (`bin/joggle.js`,
`dist/main.js`); from any other repository it was `command not found`.

**Now:** a global command, installed once:

```sh
ln -sf /Users/togmund/autotelic/mess/scripts/joggle.sh ~/.local/bin/joggle
```

`~/.local/bin` is on `PATH`. The wrapper resolves its own checkout through the
symlink, prefers `dist/`, falls back to `src/` with the `development` export
condition, and forwards every argument.

### 2. A missing model key was silent

**Was:** with `TYPESAFE_API_KEY` unset the run exited 0, and the only tells were
an `(unverified)` suffix and `0 API calls` in the footer.

**Now:** the report says it in a sentence:

```
note: no model key reached the provider, so judged rules were skipped.
      Set TYPESAFE_API_KEY (or run with --offline to say so on purpose).
```

### 3. `doppler run` is context-sensitive

**Was:** from a repository with its own `doppler.yaml`, a bare `doppler run`
looked for the wrong project and died with `Could not find requested project
'joggle'`.

**Now:** the global wrapper supplies the key itself. The first attempt -- pass
`--project joggle --config dev` -- was only half a fix, and the second session
proved it: doppler resolves a project from the **working directory's**
`doppler.yaml`, and a sibling repository's setup wins over the explicit flags.
Even `DOPPLER_PROJECT` / `DOPPLER_CONFIG` in the environment lose. The matrix,
same command, only the working directory varying:

```sh
cd mess      && doppler run --project joggle --config dev -- node dist/main.js rules   # ✓
cd shakti-v2 && doppler run --project joggle --config dev -- node mess/dist/main.js rules   # ✗
cd shakti-v2 && (cd mess && doppler run --project joggle --config dev -- node dist/main.js rules)  # ✓
```

The wrapper now fetches the one secret from the joggle root with
`doppler secrets get TYPESAFE_API_KEY`, then runs the analysis from the
caller's directory -- so the analysed root, a relative `--cwd`, and the report's
paths all stay what the caller asked for.

A second session found the other half. pi spawns the wrapper directly, not
through a login shell, and the environment it hands over has no `HOME` -- which
doppler needs to find its own auth. `env -i PATH=… joggle check …` reproduced
pi's `MissingKey` exactly, and adding `HOME` back fixed it. The wrapper now
restores `HOME` from the passwd database when it is missing, and checks a
gitignored `.env.local` beside itself before doppler, so a host without an auth
context still gets the key. The failure is also visible now: the warning goes
to stderr and the pi tools append it to the result, so a degraded run says
`no model key …` instead of leaving a bare `skipped - MissingKey` to infer.

### 4. Relative `--cwd` + a git scope found nothing (bug)

**Was:**

```sh
cd mess
pnpm joggle check --cwd ../shakti-v2 --since origin/develop     # ✗
# → discover: no source files under ../shakti-v2
pnpm joggle check --cwd /Users/togmund/autotelic/shakti-v2 --since origin/develop   # ✓
```

**Cause:** not the git diff. When no path argument is given, discovery asks
`tsgo --listFilesOnly` for the project and then keeps the files under the root
with `file.startsWith(root)`. With a relative root, the absolute paths tsgo
printed did not start with `../shakti-v2`, so the list came back empty and
discovery returned nothing. An explicit path bypassed tsgo and walked instead,
which is why it worked.

**Now:** `--cwd` is resolved to an absolute path at the CLI boundary, and
`underRoot` resolves both sides and compares path segments, so a sibling whose
name merely begins with the root no longer matches either.

### 5. The message blamed the wrong thing

**Was:** `no source files under X, and no path argument was given` -- even when
the cause was tsgo returning a list that did not survive the root comparison.

**Now:** the message names the source. `tsgo listed no source files under X`,
`no source files under X`, or `no source files under <paths> in X`. And a git
scope that comes back empty says so instead of looking like a clean repository:

```
note: the changed-file list for origin/develop is empty: nothing is in scope,
      so this run reports nothing
```

### 6. `joggle ask` on a whole repository failed hard (bug)

**Was:** one request carried a decision per candidate, so a whole-repository ask
exceeded the provider's output ceiling and exited 1 with a stack trace. `check`
had `--max-tokens`; `ask` had no budget and no fallback.

**Now:**

- `ask` takes `--max-tokens` (default 8,000) and trims the candidate list to the
  input budget before sending.
- A request the provider still rejects is halved and retried, down to one
  candidate -- the same degradation `check` uses for its chunks.
- A typed failure prints one sentence, not a stack trace.

Narrowing the paths remains the best answer, and the per-directory ask that
worked before still works.

### 7. `joggle_check` output was unbounded

**Was:** a `scope: "all"` tool call returned ~1,186 findings / ~51k characters
in one result; the default `scope: "changed"` returned the same because the
machine-local stored run was the full-repo one and nothing had changed, so it
replayed.

**Now:** the pi tool takes `limit` (default 50, `0` for all) and always reports
the total:

```
showing 50 of 1186 findings; narrow the scope, pass rule, or raise limit to see the rest
```

The CLI-side escape remains `--no-replay`.

### 8. `/joggle` and `joggle_check` disagreed about `cwd`

**Was:** the tool resolved a relative `cwd`; the slash command passed `--cwd`
through raw, so it hit bug #4 while the tool call did not.

**Now:** #4 is fixed at the CLI, so both forms resolve the same way. The slash
command also applies the same non-invasive cache rule as the tool.

### 9. Judged results depended on pi's ambient environment

**Was:** the extension ran `dist/main.js` directly, so it inherited pi's
environment (no key) and pi runs were `(unverified)` unless `JOGGLE_BIN` pointed
at a wrapper.

**Now:** the extension prefers a `joggle` on `PATH` -- on this machine, the
doppler-aware wrapper -- so pi and the shell produce the same judged results.
`JOGGLE_BIN` still overrides, and the checkout build is the fallback.

### 10. Noise and duplication on a real repository

Three changes, and one honest limit.

- **`field-type-drift` reported one finding per field, all anchored at the
  declaration's line**, so a type with five drifting fields read as five
  duplicates at `pay-programs.ts:45`. It now emits one finding per declaration
  that lists the fields: `5 field(s) of HourlyPayBreakdown disagree ...`.
- **`language-drift` split prose words differently from code names.** A doc that
  wrote `SortedByDate` became the lowercase blob `sortedbydate`, which no
  identifier could contain, so a name that existed was reported as missing. It
  now splits camelCase the same way declarations do. The reserved words that
  collide with the Choice's own decline option (`none`) or are language
  primitives are filtered too.
- **`object-shape` suppressed too little.** It treated a literal as a use of a
  named type only when the literal carried every field, but optionality is not
  recorded for an interface, so a literal that dropped an optional field was
  reported. A literal whose keys are all fields of a named type is now a use of
  it. On `shakti-v2` the repeated-shape total fell accordingly.
- **Open:** literals that genuinely have no type in the repository -- knex
  insert payloads, Mapbox style objects, test fixtures -- are still reported.
  No code change can know they are structured data; that is what
  `joggle.config.json` is for. `shakti-v2` has no config, so the adapter layer's
  `Money`/`number`, `Count`/`number` pairs and the fixture shapes are all noise
  there until one exists. The `evidence.repository` field and `ignore` list are
  the mechanisms.

## Also found while fixing

**A replayed report dropped its notes.** The replay path kept the stored
diagnostics but replaced the stored notes with the replay message alone, so a
replayed run lost the funnel and every "rule skipped" line -- which made a
replay look like a run that had nothing to say. The stored notes are now kept.

## Round three

A second real PR against `shakti-v2`, and four more things the tool decided.

**`reimplemented-primitive` keyed a body by callee names alone.** Three of
thirteen were false positives: `companyYearTotalsJson` was reported as a
re-implementation of `crewSummaryToJson` because both read `Number -> Number ->
Number -> String`. The key now carries what each call READS, not just what it
calls. Keying on the raw argument text instead broke the true positive -- one
declaration writes `save(validate(normalise(row)))` and another sequences the
same three calls through locals -- so a nested call and a bare identifier (a
local or a parameter) become `#`, while a member access or a literal is kept. A
chain therefore keeps only its source, and two different sources stop looking
alike.

**`import-cycle` ignored the scope.** A PR-scoped run reported all eight of the
repository's cycles while saying it had narrowed to 18 files, all of them in UI
files the PR never touched. A cycle is now in scope only when one of its members
moved, the finding is anchored at a changed member, and the note names how many
were left out. `layer-direction` and `layer-purity` had the same hole and are
fixed the same way.

**`object-shape` penalised composition.** Composing a type made the literals
that used to match its full field set look unnamed, so the rule reported exactly
what `compose-types` and `name-the-primitive` recommend. A declared type's field
set is now its own fields plus the fields of the types it composes --
`extends`, `A & B`, `type T = A` -- resolved across files.

**Grouped findings move the count without the substance moving.** In the PR's
own files, 13 before and 13 after: the composition finding was fixed, but
grouping `projectRole` with `dailyAverages` split in two when those fields moved
into `PersonRef`. The number is a count of findings, not a score; the PR-scope
total went 30 -> 33 entirely from `object-shape` notices outside the branch.

Measured on the whole repository: 1126 -> 1088 findings, cycles unchanged.

## Still open

**`<cwd>/.joggle` is still how the CLI writes into a checkout.** Running
`joggle check` without `--cache-dir` creates `.joggle/` in the analysed
repository, which is the only way to write into a tree you are inspecting. The
pi extension passes a machine cache and `scripts/joggle.sh` is the shell, but
the CLI itself cannot know whether a repository is being onboarded (where the
committed cache is the point) or visited (where it is litter).

## Disproved suspicions

- **"`--pr` uses the invoking repository's `gh` context."** False. `gh` is
  invoked with the target: `gh pr view 1568 --json baseRefName` with
  `cwd=.../shakti-v2`. The failure in #4 was the relative path and nothing else.
- **"`--pr` diffs against a stale local base branch."** False. `prRef` prefers
  `origin/<base>` when it resolves, so a stale local `develop` cannot widen the
  scope. A hand-rolled diff against the stale local ref gave 44 files where
  joggle correctly reported 18.

## Operator errors, not joggle's

- `timeout` does not exist on macOS by default.
- Piping the 50k-character tool payloads into a model's context twice -- which is
  itself the argument for the `limit` in #7.

## Round four: PR #1572

A PR whose main act is moving 44 files into a package, plus five response
schemas. Scoped with `--pr-number 1572`. Six items from the run, five fixed and
one pushed back.

**A moved file inherits its whole history (fixed).** `--pr` reported findings in
files the PR only *renames*. Git knows the difference, so the scope now splits:
`changed` is added, modified and renamed-with-edits; `moved` is `R100`, a rename
git is certain kept every byte. Content rules (`object-shape`,
`field-type-drift`, the duplicate rules, ...) read `changed` alone, because a
moved file's bytes are not new. Graph rules (`import-cycle`, the two layer rules,
`module-direction`, `dependency-fit`) read the union, because the MOVE can put a
module on the wrong side of a boundary it used to respect. `--changed` detects
the same thing from content hashes, so both scopes answer a move the same way.

On PR #1572: 54 findings -> 31, and `field-type-drift` 14 -> 6, `object-shape`
15 -> 5. The scope note says how many were skipped.

**A raw mirror is not drift (fixed).** `UnparsedPlanterDay.treesPlanted: number`
against `PersonSummary.treesPlanted: Count` is the parser doing its job. A
declaration whose name starts `Unparsed`/`Raw` or ends `Json`/`Dto`/`Row` is the
unbranded side of one, and the rule now skips any pair that involves one. The
markers are in `policy.fieldTypeDrift`, so a repository can extend them.

**An indexed access (partly fixed).** `PersonPayrollRecord['personId']` and
`PersonId` are one type. The rule now reads a field's declared type out of the
type it indexes, so `T['k']` and the type it names compare equal. Where the
indexed type is derived from a `Schema.Struct`, its fields are not in joggle's
index and the access cannot be followed -- and there the pair is now SKIPPED
rather than reported, because a disagreement about a type nobody can see is the
wrong direction to guess. The type trace (`--types`) is what resolves it
properly. Deliberately NOT resolved: a bare alias. Following `type Money =
number & { _brand }` to its right-hand side would make `Money` and `number`
compose, silencing the drift the rule exists to catch.

**`object-shape` on test scaffolding (fixed).** The three loudest findings were
request options in REST tests and `fast-check` record shapes. Test files are now
skipped: a shape nobody names is a real problem in application code, and a test
is where a fixture is supposed to be repeated.

**`hoist-to-domain` and the request rule (fixed).** `resolveDateRange` and
`resolveDateMode` are rules about what the endpoint ACCEPTS, and the UI's version
of the mode has different semantics, so there is no second copy to disagree
with. The duty vocabulary now offers `request_validation`,
`input_adaptation` and `mechanical` (a cache key), and the reader already drops
anything that is not `domain_logic`.

**`language-drift` on "none" (fixed earlier).** "None" collides with the
Choice's own decline option and is an ordinary English word. It is filtered
before the question is asked; a regression test covers it.

**`limit` is not documented (fixed).** It is in the tool description and in
`JOGGLE.md` now.

### Pushed back: `compose-types` contradicts `field-type-drift`

It does not, on any pair, and the two cannot: `compose-types` fires only when
`canCompose` is true for every shared field, and `field-type-drift` fires only
when it is false for one. They share the predicate. The apparent contradiction is
one declaration with two different counterparts: `UnparsedPlanterDay` composes
`PlanterDay` (a composition candidate) while its `treesPlanted` disagrees with
`PersonSummary` (a drift). Those are two facts about one type, not one rule
overruling the other -- and the second is the raw mirror above.

Tightening `compose-types` to require *identical* types would make it disagree
with `field-type-drift` in the other direction: it would drop the genuine
composition where two shared fields are written `AbortSignal` and `AbortSignal |
undefined`, which is exactly the false negative `canCompose` was written to fix.

### Still open

**A changed-lines scope.** A file touched only by an import-specifier rewrite is
in `changed`, and its findings are as old as the file. Excluding it needs a scope
that is the changed *lines*, not the changed paths -- a bigger change than the
rename split, and the other half of taking this run from 85 to 15.


## Round five: the false positives that stayed

Four classes from a broader run on the same repository. All four fixed; the
trade each one made is noted.

**`object-shape` fired on a literal that HAS a name (fixed).**
`satisfies Record<ProjectRole, ReportingBand>`, `const byRole: ComparisonsByRole
= {...}` and `{...} as MultiComboBoxFilterProps` all name the literal, and the
rule keyed only on the literal's own field set. `satisfies`, `as` and an
annotated initializer now mark a literal as declared, alongside the
`Schema.Struct` argument that already did. A `Record<...>` has no declared field
set of its own, which is why the declared-type check could not see it.

**`field-type-drift` compared two types the type system computed (fixed).**
`ProjectRole` is `(typeof PROJECT_ROLES)[number]` and `ProjectCrewRoles` is a zod
inference; there is no text to compare. Three changes: resolution follows a local
alias (so `type Count = number & Brand<'Count'>` composes with `number` -- the
"brands erased at the wire" class the adapter layer kept reporting), a union is
resolved constituent by constituent (so `ProjectRole | null` is reached), and
when BOTH sides come out computed (`typeof`, `keyof`, `z.infer`,
`Schema.Schema.Type`) the pair is skipped rather than guessed -- the same rule the
unresolved indexed access already followed.

The trade is explicit: this raises precision and lowers recall. Two genuinely
different vocabularies computed from two different consts are now silent, and the
type trace (`--types`) is what would tell them apart.

**`hoist-to-domain` mistook persistence for a business rule (fixed).** All five
took a `Knex` or a `Knex.Transaction`. The duty question now says so in as many
words: a function that takes a database handle is `infrastructure`, and the domain
is pure by design, so moving the query into it is the wrong repair however much
business logic the rows carry.

**`language-drift` reported an unsure guess (fixed).** A file-level notice at
confidence 0.56 is the model saying it cannot tell. The rule now reports only a
confident answer and drops an unsure one with the reason -- unlike the duplicate
rules, where an unsure answer still points at two declarations a reader can
compare.


## Round six: the first Astro site

`auto-emdash/site`: an emdash CMS on Astro, 44 `.astro` files and 3 `.ts` files
under `src/`, server-rendered, no islands. Before `.astro` support joggle read the
3 `.ts` files. With it, `joggle check src` parses all 47 with none unparsed, in
0.7s, asking 14 questions on about 20,000 input tokens.

**What it found.** Four findings, two verified:

- `object-shape` (verified): six pages build `{ path, siteTitle, siteUrl }` with
  no type. Real.
- `duplicate-meaning` (notice, margin 0.18): `hrefWith` in `Filters.astro` and
  `pageHref` in `InsightList.astro` both copy the query string, edit one
  parameter and rebuild a link. A fair thing to put in front of a reviewer.
- `duplicate-implementation` (printed, though its question answered no at 0.39):
  three cards share the `Props` shape `{ entry: any }`. The model is right that
  they are not one concept; what they share is that none of them uses the
  generated `Insight`, `People` or `Project` type. That is the candidate
  `astro/prop-skips-content-type` is for.
- `dependency-fit`: "site imports `astro:content` but does not declare it". A
  false positive. `astro:*` specifiers are virtual modules the `astro` package
  provides, and the site declares `astro`. **Open.**

**What it missed, and why.** The `buttons` array built identically in
`Text.astro` and `SplitTextMedia.astro`, and `entry.data.terms?.category?.[0]` in
five files, were not reported. Both are top-level frontmatter statements, and a
unit is a function, an interface, a type or a class: top-level code in a `.ts`
file is equally invisible. In a `.ts` codebase that is a small blind spot; in an
Astro one the frontmatter's top level IS most of the logic. **Open**, and the
largest gap this run found.

**A keyless run is replayed after the key arrives (open).** The first run had no
`TYPESAFE_API_KEY`; the second, through `scripts/joggle.sh`, had one and printed
"replayed the previous run: nothing it depends on changed", with every judged
rule still reported as missing its key. Whether a model is reachable is an input
to the report and is not in the run manifest. Deleting `last-run.json` under the
machine cache was the workaround.

**No-paths falls back to the walk without saying so (open).** The site does not
install `tsgo` (Astro projects typecheck with `astro check`), so `tsgo
--listFilesOnly` failed and the no-paths run walked the whole tree instead: 58
files including `scripts/` and config files, and a "not parsed" note listing 103
images, markdown files and JSON. The fallback is reasonable; that nothing says
tsgo was unavailable is not.

**An answer replayed from the wire cache can miss `.joggle/answers/` (fixed).**
Onboarding the site (`site/.joggle/`, first judged run with the key) wrote 55
shards, but an `--offline` run with an empty machine cache still reported "2
unavailable": one Classify decision, asked twice through `memoize`, was absent
from the committed store. A second keyed run with the run cache deleted still
left it missing; a third (`--no-replay`) found it absent, replayed it from
`wire.json` and wrote it. CI would have reported those findings as unavailable.

The cause was in the store, not the wire. `put` marked its shard dirty outside
the writer permit, and `flush` read the dirty set, wrote it, then cleared the
whole set, so a put that landed mid-flush lost its mark and its own flush found
nothing to write. The answer stayed in memory, so the run looked right. With 64
concurrent puts, one reached disk. `flush` now takes and clears the set in one
step inside the permit. The check that caught it, an `--offline` run with
`XDG_CACHE_HOME` pointed at an empty directory, is worth doing after any
onboarding.
