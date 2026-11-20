# @autotelic/jig-cli

## 0.7.1

### Patch Changes

- 67961a5: A progress line whose units add up, and a baseline refusal that names the real cause.

  The progress line printed the WIRE request count as "resolved". That is a different quantity: a
  replayed candidate never makes a request, and one batched call can answer many candidates, so a
  ten-minute run reported "198/10040 resolved (31 judged, 9731 replayed)" while writing 17,000
  answers. The counters are now three distinct units — `judged` (answers written, one per
  candidate), `replayed` (per-decision cache hits), `apiCalls` (provider requests) — and
  `resolved` is their terminal sum with `unavailable`. The progress document carries the same
  fields, plus `unavailable`.

  `jig baseline` refused with "joggle reads its model key from this run's environment" whether or
  not the key was present. On a repository that sets `unavailable: "count"`, the key IS present and
  the candidates are still unjudged — a per-rule ceiling, not a missing secret. The refusal now
  states which case it is, says that no key can raise a ceiling, and points at `--allow-unjudged`
  for a repository whose engine policy already declares that unjudged is expected.

  The README also states the direction that works: accept from a KEYED run once, and both modes
  pass, because a keyless run sees a subset of a keyed ledger. Accepting keyless and then running
  with a key fails by construction.

## 0.7.0

### Minor Changes

- 0487a0b: A finding's identity no longer depends on whether a judgement reached it.

  A cluster's identity included **the symbol the model chose to keep**, so the same duplicate had
  one name when a keyed run judged it and another when CI ran keyless — and a ledger written in
  either mode matched nothing in the other. That is why a developer with a key could not run the
  gate unscoped and pass, and why "the engine ledger owns the bulk, the gate ledger stays short"
  could not hold.

  Identities are now the rule and the cluster's **members** (`file:name`, sorted, no line
  numbers): membership is decided by the detector, before any question is asked, so keyed and
  keyless runs agree. Verified on this workspace: the keyless identity set is a subset of the keyed
  one, with zero renames (the keyed run adds findings; it no longer moves them).

  **This renames the ledger, once.** Accepted identities written by joggle before this release will
  not match; re-run `jig baseline` on the default branch (and the engine's `--update-baseline`)
  after upgrading. The gate's report names the difference as new findings, so nothing is lost
  silently.

  Three related corrections:

  - `jig baseline` refused any ledger containing a **deterministic** finding, because such findings
    are marked `judged: false` — an exact duplicate has no question to ask. It now refuses only when
    an engine actually skipped judgement (its census reports unjudged candidates), and says how many.
  - The baseline refusal quotes the **per-rule ceilings** that dropped candidates, so a run that
    stopped at a constant no longer sends the operator to `--max-tokens`, which cannot raise it.
  - `jig init --force` no longer replaces a repository's decisions: an existing layer's `include`
    set is kept (it is authored intent, not a draft), and a JIG.md/ONBOARD.md that differs from the
    generated text is left alone with the fresh copy beside it as `.new`.

## 0.6.0

### Minor Changes

- 94aca21: A long run says where it is, and the version a binary prints is the version on npm.

  A judged run of 13 minutes printed **nothing** — stdout and stderr at zero bytes until the report
  — so the only way to tell working from hung was to watch the answer cache grow. Two surfaces now
  exist, both optional and both machine-local:

  - **stderr, every 10 seconds**, counts only so every machine format on stdout stays clean:
    `joggle: 4210/7787 candidate(s) resolved (1234 judged, 2976 replayed) · 1.9M/4.0M input tokens · 13m20s`.
    Judged and replayed are named separately because "findings" and "findings no judgement reached"
    added into one number is a misread that already happened.
  - **a progress document**, rewritten atomically (temp + rename) on the same tick at
    `<machine cache>/progress.json`: `{ phase, candidatesTotal, candidatesResolved, judged, replayed,
    apiCalls, inputTokens, inputBudget, elapsedMs, updatedAt }`. A CI log or an agent can poll it.

  `jig check` also announces each engine's start and finish on stderr, so the gap between concurrent
  engines is visible instead of being swallowed until the merged report.

  The answer ledger is now written atomically too: temp then rename, both layouts. A run killed
  mid-write leaves the previous whole ledger instead of a truncated tail, which the reader would
  have counted as skipped lines — losing answers silently.

  `jig --version` and `cutlist --version` print the package version plus the checkout's short sha
  (`jig v0.6.0+1a2b3c4`) instead of a hardcoded `0.0.0+<cwd sha>`, so an npm install and a checkout
  are distinguishable, and "is my install current" is answerable from the binary.

  One more line in the report: the headline separates findings from findings nobody judged
  (`… ; 7787 candidate(s) not judged; 5315 of these finding(s) unverified`).

## 0.5.0

### Minor Changes

- eefcec0: `init` starts the ratchet at today's debt, instead of at a gate nobody can pass.

  A repo-wide gate (`mode: all`, the adoption default) with an EMPTY ledger makes every finding
  already in the tree a new identity: adoption is red on day one, and every pull request fails on
  debt it did not create. On a repository with judged rules the state can be impossible to leave,
  because `jig baseline` needs a model key. That is what one consumer hit: a green scoped lint
  gate and a red, unscoped `jig check` naming duplicate declarations in files their PR never
  touched.

  `init` now runs the engines once and accepts what it finds as the baseline — one reviewed commit,
  with the count in the summary, the ledger in the diff, and `jig check --limit 0` to read it. A
  run that could not judge (no key) says so, because adding a key can rename its identities. A
  `touched-files` gate still gets an empty ledger: it holds nothing outside the change, so it needs
  no ledger to pass and should not pay for a full run at init.

  The report also explains the state it is in: when `failOn: any-new` holds findings against an
  empty ledger, the gate line says that the ledger is empty and names both ways out (`jig baseline`
  with `--allow-unjudged` when there is no key, or a scoped `jig check --since <base>`).

  Two documents that lied are corrected: `JIG.md` claimed "the first run explains the debt instead
  of failing on it" while writing an empty ledger, and the README called `touched-files` the
  adoption default while `init` had moved to `all`. The generated CI guidance now names the two
  questions: scope the pull-request run to the change, keep the unscoped run on the default branch.

## 0.4.3

### Patch Changes

- 947c439: Say what a green gate did not answer.

  Three additions to the text report, each from the same question: which reading of "0 findings"
  is this?

  - The headline now carries the unjudged count (`… ; 11,946 candidate(s) not judged`). A judged
    rule whose model key was absent has not assessed the architecture, and the per-engine note
    was too easy to scroll past.
  - A scoped run says how many findings it read outside its change set (`412 finding(s) outside
    this scope, not shown`). `--pr` narrows to the files the pull request touched; a cross-file
    finding filed on an older file is then invisible, so the scoped number is a floor, not the
    repository's answer.
  - The gate names the rules that are reported and cannot fail it (`2,112 finding(s) reported and
    cannot fail this gate (failOn: error): …`). A warning under `failOn: error`, a baselined
    identity, and an advisory engine are all displayed like enforced findings and are enforced by
    nothing; a repository keeping a second, errors-only lint config can now see which rules live
    only there, without diffing two JSON files.

## 0.4.2

### Patch Changes

- 96901d5: Do not query the host registry while an extension loads.

  The duplicate-install guard added in the previous patch called `pi.getAllTools()` at the top of the
  factory. pi's loader installs a throwing placeholder for every action method until the extension
  has committed — "Extension runtime not initialized. Action methods cannot be called during
  extension loading" — so the guard did not detect anything: it made the extension fail to load on
  every boot, in every repository, whether or not a second copy was installed. That is worse than
  the conflict it was meant to soften.

  The guard is removed. Reading pi's loader settles what a duplicate actually is: both extensions
  stay loaded, one diagnostic is recorded per conflicting name, and load order decides precedence.
  Detecting that is the host's job. Making sure there is one install is configuration's, which the
  generated `ONBOARD.md` and the README now state in one sentence.

## 0.4.1

### Patch Changes

- 442e3ce: A second install of the extension no longer breaks the boot.

  pi loads extensions per scope, so one package can be present twice: a user-scope checkout
  (`pi install <path>`) and a project's own dependency. Both declare the same tool names, and pi
  refuses the second registration — six load errors for jig, one per tool for room, on a boot that
  would otherwise work, with the winning version decided by load order.

  The extension now checks whether its own tool names are already registered by a DIFFERENT file
  before registering. If so it skips once, with one line naming the other install and which file
  it skipped; if they belong to its own path it registers as before, because that is a reload.
  A host without `getAllTools` is unchanged.

  The onboarding prompt and the README also say it plainly: install the agent surface in ONE
  scope.

## 0.4.0

### Minor Changes

- a6edace: `jig check` answers for a change, not only for the repository.

  `--changed`, `--since <rev>`, and `--pr` / `--pr-number <n>` narrow a run to a change set —
  the report and the gate together. This was the one thing joggle could do and its harness could
  not, so "did this pull request introduce anything" had to be assembled from three tools by hand.

  What is narrowed is the REPORT, not the engines. They still read the whole tree: a cross-file
  rule cannot answer from three files, and a scoped oxlint invocation cannot see an import it
  never loaded. Afterwards each engine's counts are recounted over the change set, and
  everything an engine said about HOW it ran — replayed, skipped, candidates not judged — is
  carried through untouched, because a scoped run must still be able to say what it did not look
  at.

  Three rules keep the smaller report from becoming a bigger claim:

  - The text report prints the scope and the number of files read. "0 findings" over three
    changed files and over the repository are different sentences.
  - A scope that cannot be resolved — a revision git does not know, no `gh`, no pull request for
    the branch — exits 3 and says so. It never falls back to the whole tree, which would answer
    "is the repository clean" to a question about one change.
  - The stale-ledger line is absent in a scoped run. A scoped diff compared the ledger to a
    handful of files, so every identity outside that slice would read as stale; only a
    whole-tree run can say an entry stopped firing.

## 0.3.2

### Patch Changes

- f8e19ba: Pin `@effect/platform-node-shared` as a real dependency.

  `@effect/platform-node` constrains its shared package with a caret and nothing else, so a
  consumer whose lockfile resolves that caret upward got a shared package built for a newer
  Effect than the one the tool pins: `cutlist@0.0.2` died on `effect/dist/process/CommandLine.js`
  in a repository that also had Effect 4.1. The workspace `overrides` hid this locally; a
  dependency is what publishes, and no package declared one. Both published tools now do, and
  `scripts/check-catalog.mjs` now fails when a package uses `@effect/platform-node` without
  pinning the shared package beside it, so the next tool cannot publish with the same gap.

## 0.3.1

### Patch Changes

- 9fabc38: `--format github` carries the census. An engine that skipped a rule, left candidates unjudged, or
  replayed found _nothing to say_, which is not the same as nothing to find — and the annotations
  used to drop all of it, so a CI step could print no annotations at all and exit 0 while the rules
  it exists to run never looked. Each such engine now emits
  `::warning title=jig census (<engine>)::<why>` before its findings.

## 0.3.0

### Minor Changes

- 010a06d: `jig check` runs every engine read-only (`JIG_READ_ONLY=1`): a report that edits the tree it
  reports on changes its own next answer. The gate's section also names where its failures are
  (`file:line` samples per rule) instead of only counting them, so a run that re-opens dozens of
  findings in one rule can be acted on from the log.

## 0.2.3

### Patch Changes

- 461ec12: The cookbook's stacked-branch recipe now separates the two runs: `--since <base>` is the gate's
  run, and accepting is one full run at the head (`--update-baseline ... --merge-baseline`),
  because `--update-baseline` refuses a scoped run. A scoped accept folds findings differently and
  can miss the identity a full run reports.

## 0.2.2

### Patch Changes

- 4998735: `--format github` annotates the findings the gate actually holds as `::error`, not by the
  engine's own severity. `failOn: any-new` fails on novelty, so it can hold an `info` finding —
  which printed as a notice and left the log with a red gate and no red finding in it.

## 0.2.1

### Patch Changes

- e52f439: The cookbook's stacked-branch recipe now gives the ordering rule, not just the scoped run:
  accept and rebuild every branch first, then rebase bottom-up once, then push once. A commit on
  the parent (an accepted identity, a rebuilt catalog) re-dirties every child above it, so a
  cascade run between fixes runs once per fix — five times through a 22-branch migration.

## 0.2.0

### Minor Changes

- e6a6d56: jig baseline refuses findings no judgement reached (`--allow-unjudged` overrides), and names
  TYPESAFE_API_KEY as what judges them: without one the same findings are named from what the
  rules could see alone, so a ledger written locally does not match a judged run and passes here
  while failing CI.

  It also checks its own postcondition. The ledger decides novelty alone, so under
  `failOn: warn|error` or a `maxWarnings` ceiling the gate holds by severity and cannot be
  cleared by accepting findings; baseline now says which regime held and exits with `check`'s
  code instead of printing success over a red gate.

  `--format github` annotates identities the ledger already accepts as `::notice` rather than
  `::error`, and always emits the gate's own line, so an accepted finding is never the last red
  line in a CI log.

## 0.1.3

### Patch Changes

- 48ae768: The agent surfaces run the project's jig, and their tools can pass flags.

  `jig_check` / `jig.check` preferred a `jig` on PATH over the repository's own install, so an
  agent and CI could run different versions with nothing in the report saying which one answered.
  The order is now project `node_modules/.bin/jig`, then PATH, then this package's build or
  source; `JIG_BIN` still overrides all of it, and every result carries the chosen launcher
  (`details.launcher` for pi, `metadata.launcher` for OpenCode).

  Both surfaces also accept an `args` passthrough on `jig_check` and expose `jig_baseline`, so a
  human-approved acceptance does not require leaving the tool surface. Judging still does:
  `pi.exec` takes no environment, so a model key or an engine-only flag is a shell call, and
  SECRETS.md now says so next to the host-environment contract.

## 0.1.2

### Patch Changes

- eb236d8: The gate a fresh repository gets by default is `all`, and an engine that dies is infrastructure.

  `jig init` used to scaffold `gate.mode: "touched-files"`. That mode measures against HEAD, so
  on a clean CI checkout the touched set is empty and `jig check` exits 0 whatever is in the tree:
  the shipped config gated nothing, and only the opt-in pre-commit hook made the mode useful. Init
  now defaults to `all` and prints the tradeoff, so `--gate touched-files` is a decision rather
  than a surprise.

  An engine that ran and produced output jig could not read was summarized `ran`, because the
  provenance fallback answered `ran` for every document without a summary and won the branch that
  was meant to mark it `errored`. The gate therefore saw no infrastructure and `--format github`
  showed a green PR over a run that read nothing. `engineStatus` checks the unreadable finding
  first; the same run now exits 3.

  Also: `init` passes `--allow-unjudged-baseline` when it births joggle's ledger, notes a
  wholesale `.joggle/` ignore with the narrowed block, documents `pnpm -s jig` for machine
  output, and says that a judged run can grow the ledger before it shrinks it.

## 0.1.1

### Patch Changes

- Updated dependencies [c7c94bf]
  - @autotelic/protocol@0.1.1

## 0.1.0

### Minor Changes

- cf15738: `jig` grows the commands its README already named, and `init` writes `ONBOARD.md`.

  The root README advertised `jig explain/learn/promote` while the CLI had only
  `check/baseline/engines/init` — names without commands. All three now exist, as pure
  functions of the one report (`src/commands.ts`) so each is checked by a test rather than by
  running the world:

  - `jig explain <engine/ruleId>` expands a rule's findings in this repo — message, `help`,
    `docsUrl`, and any `repair` — so `help` is a fix, not a restatement. It distinguishes the
    engine that is not configured from the engine that ran and said nothing.
  - `jig promote` shows the ratchet's next rung: the accepted identities a run no longer
    earns. `--write` drops exactly those and refuses to accept new ones — the ratchet only
    ever shrinks; accepting is `jig baseline`, a human's decision.
  - `jig learn` rewrites the agent cookbook from the rules the repo already accepts, so an
    agent can tell "new" from "known" without a second source.

  `jig init` now also writes the onboarding prompt (`agent.onboarding`, default `ONBOARD.md`)
  alongside the cookbook; both names are in the config schema and the exemplar, and the default
  config declares both.

- db85419: The gate honors its config, and `jig check` publishes an exit-code contract.

  `report.format`, `gate.failOn`, and `gate.mode` were decoded and then ignored — knobs that
  lied. `jig check` now reads all three: `report.format` is the default when `--format` is
  absent; `failOn` chooses whether the gate fails on errors, errors-and-warnings, or (the
  default) any identity not in the baseline; and `gate.mode: "touched-files"` gates only on
  findings in files the working tree touches, widening to `all` when git cannot say rather than
  narrowing to an empty set that would pass everything. `report.maxWarnings` remains the
  second, severity-blind ceiling.

  The exit codes are now a documented contract: `0` clean, `1` findings, `2` usage/config (a
  command line that did not parse; `--help` stays `0`), and `3` infrastructure (an engine that
  could not run — an unread run is not a dirty one, the report-level twin of the `replayed`
  and `unjudged` census fields). The gate is one pure function, `gateVerdict`, and the human
  text renders its verdict so the report and the exit code can never disagree. The `Gate`
  config's `report.format` also accepts the projections `sarif`, `lsp`, and `codeclimate`.

- a52046e: `jig init` keeps the engines a repository already configured, reads a `cutlist.config.json`
  where its engine scans, and documents the room.

  A `--force` run used to rewrite `jig.config.json` from what detection found, which on a repo
  that had grown a second `oxlint` config, a per-package `plumb`, or a `cutlist --cwd` engine
  silently deleted those engines. Init now starts from the configured list: a repo's own entry
  wins for the same id, detection adds what is missing, and an engine whose command no longer
  resolves is dropped with a note instead of sitting in the plan looking enabled.

  `cutlist`'s generated-artifact block follows the directory the engine scans, so a catalog
  built under `examples/` is described from the repository root, and the summary names the
  config it kept rather than reporting cutlist as absent. Repositories that ship or build a room
  (`packages/room`, `@autotelic/room`, or a `room.config.json`) get `jig room` in `JIG.md` and
  `ONBOARD.md`, plus a note pointing at `jig room plan` when no config exists yet.

- 6025e31: `jig init` can make the harness real: a scoped pre-commit hook, and the ignore lines that hide it.

  The two are separate decisions and both are opt-in, because either one changes what everyone on
  the repository experiences:

  - `--unignore` removes the exact `.gitignore` lines that hide the harness. A path hidden by a
    _pattern_ is reported, never edited — nothing here rewrites a glob — and the summary says which
    ones need a person.
  - `--hooks` writes `.git/hooks/pre-commit` running `jig check --gate touched-files`, which is the
    scoped gate that already exists. It steps aside **loudly** when the CLI is not on the machine,
    because a hook that fails for a contributor without the harness turns a local-only gate into a
    hostile one; and it never replaces a hook that is not jig's.

  The generated prompt's commit step now teaches both, with the stop-and-ask that goes with them.

- f1e108b: `jig init` installs four small agent skills beside the config and the docs.

  Setting up a room-and-reviewer workflow was three manual steps in every repository — install
  intercom, name the sessions, remember the resume command — and every step was a place to get it
  wrong. A skill is instructions a host loads on demand, so it ships with the harness:

  - `room` (14 lines) — plan, daemon, session, resume; `cursor lost` and "a card written at an older
    sha is a question, not an instruction".
  - `intercom-setup` (20) — install once, alias each session, and **list before you send**: a peer
    that is not listed receives nothing and the send still looks successful.
  - `feedback-loop` (14) — a builder and a tester on a real repository: the tester owes the command
    and its output, the builder owes the commit and the gate.
  - `project-run` (18) — a GitHub label plus a Linear project as the whole brief: open the room, take
    one item, watch `gh pr checks --watch` and `jig room resume`, and report to a tackle session,
    starting one in the tackle checkout when none is listed.

  They are files under `.agents/skills/` — the one directory pi and OpenCode both discover — so init
  writes them like any other harness file, and the onboarding prompt says so in the step that already
  runs `jig init`. A skill someone edits is kept and reported; `--force` replaces it.

- 545925b: `jig init` now configures the engines it enables, drafts the vocabulary it can decide, and
  stops a fresh checkout from running stale code.

  From the second adopter run (shakti-v2, tackle @ `fbd0fcf`):

  - **joggle gets its correctness flags, not just its name.** `init` writes
    `config: "joggle.config.json"` and `args: ["--types", "--no-replay", "--baseline
    .joggle-baseline.json"]` on a TypeScript repo. A replay is not a look, and an untyped check
    misses the Effect rules; `--typecheck` stays off until joggle's tsgo run reads each
    package's `tsconfig` (it reports ~22k false errors on a real monorepo).
  - **The ratchet is born accepted.** When the effective config references an engine ledger and
    the file is absent, `init` writes it once (`joggle check --update-baseline`), reports how many
    findings it accepted, and never rewrites it — same rule as `.jig-baseline.json`. A ledger the
    config does not reference is not written at all.
  - **Architecture layers are drafted from the workspace.** `packages/*` and `services/*` become
    `architecture.layers` with `name`/`include` and no `forbid`: the include set is decidable, the
    order and the purity ranges are a person's judgement. Without any block, joggle cannot ask
    "should this import exist" and a repo never sees the 184 findings that question produces.
  - **A linked, unbuilt checkout says so.** `bin/jig.js` checks for `dist/` and prints
    `run pnpm build` instead of throwing `ERR_MODULE_NOT_FOUND`; the prompt's checkout line tells
    the agent to build before installing and after changing the CLI.
  - **Workspace installs stop failing.** A pnpm workspace root gets `pnpm add -Dw` (the literal
    `pnpm add -D` is `ERR_PNPM_ADDING_TO_ROOT`), and the unpublished-package fallback is keyed on
    "the install failed" rather than on a 404 specifically.
  - The gitignored-path report no longer counts `.jig-baseline.json` twice.

- fbd0fcf: `jig` now tells an adopter the truth about what it wrote, and answers to every name a report prints.

  The first adopter run (shakti-v2) surfaced six things a prompt could not fix by prose alone:

  - **`init` reports gitignored output.** It writes a config, two docs, a ledger, and a
    generated block; that repository ignores all seven, so the harness was local-only and nothing
    said so. `init` now asks `git check-ignore` about what it wrote, reports the paths in its
    summary, and adds a note; the pasted prompt has a step that stops when the harness cannot be
    committed.
  - **`init` notices another ledger.** A repo that already gates findings with its own baseline
    gets a note naming it and asking which ledger owns the findings, instead of a second silent
    ledger.
  - **Next steps print an invocation a person can type.** When the project has its own
    `node_modules/.bin/cutlist`, the steps say `pnpm exec cutlist build`, not `cutlist build`
    (127: command not found).
  - **`explain` accepts all three spellings of one rule**: the bare id, the id the JSON report
    carries, and the id the human report prints. Only the printed one resolved before.
  - **`menu` reads the configured `cutlist` engine's `--cwd`.** A repo that catalogues a
    subdirectory used to report "no cutlist artifact" while `jig menu --cwd examples/self`
    worked; the engine now decides where the artifact lives.
  - **The prompt emits one branch per step**, names the unpublished-package workaround (link the
    checkout; `pi install <unpublished-name>` is treated as a relative path), says that an
    OpenCode config denying tools wholesale hides the plugin's tools, and records that secrets are
    two nested layers at most and must be entered from each layer's own root.

  jig's pi extension also restores `HOME` when the host hands over an environment without it —
  `pi.exec` takes no `env`, and a launcher such as Doppler finds its auth there. `SECRETS.md`
  gains the two-layer recipe and the four rules that follow from Doppler's working-directory
  resolution.

- cdca144: Judged provenance in the report, and `jig` as the one command with projected output.

  The report now distinguishes what an engine **found** from what it **did**. A diagnostic may
  carry its judged provenance — the entropy `move`, a `score`, a `confidence`, and a proposed
  `repair` with a `complete` flag — and an `EngineSummary` may carry a `status`
  (`ran`/`replayed`/`skipped`/`errored`), an `unjudged` count, and a `drops` breakdown. All
  fields are optional and additive, so a reader of the previous report is unaffected. The
  invariant they serve: "0 findings" and "not looked at" never render the same again.

  `jig check` gains the outward projections `--format sarif | lsp | codeclimate | jsonl`
  (beside the existing `text`, `json`, and `github`), implemented as pure functions of the one
  report and checked against `protocol`'s worked examples. `--limit N` bounds the human
  finding list without ever truncating the census or the ratchet. The human form is now the
  only renderer: `jig check --format text` says what each engine did, marks an unjudged finding
  `(unverified)`, and shows its `move`, `score`, and `repair`. The pi extension and the
  OpenCode plugin are transports over that text rather than re-renderers.

- 3576216: `jig init` writes `ONBOARD.md` as one paste-able prompt that sets the whole harness up, and
  it now knows how the CLI gets onto a machine.

  The old file was a reference page an agent had to interpret. The new one is the shape that
  works in the tools people actually paste from: "put `jig` on this machine" first, with the
  package manager's own verb (`pnpm add -g`, `npm install -g`, `yarn global add`) and the
  source that is honest for this repository — `./packages/jig-cli` when the tree builds jig,
  `@autotelic/jig-cli` when it does not — then the PATH fix when the global bin directory is
  missing (`pnpm setup`), before anything is installed or run.

  From there it walks: read the config it just wrote, install the engines the census says are
  missing (devDependencies, never global), run `init`, read the census before the findings,
  wire the agent host (`pi install … --local`, or `"plugin": ["@autotelic/jig-cli/opencode"]`
  in `opencode.json`), and — in a repository that keeps a room — show `jig room plan` and stop.
  A host that is already wired is updated rather than added twice, the baseline and a gate
  change stay in the never-without-asking list, and every step that installs something says
  **STOP and ask**.

- 48f83a7: `jig room doctor` names a missing `pi`, and onboarding says what the room needs on a machine.

  Both halves of the loop run `pi`: the review job spawns it, and the wake resumes the project
  session with it. A machine without it looked healthy until the first event nobody answered, so
  doctor now checks it beside `celld` and names the consequence. `doctor` also takes an optional
  PATH lookup, which is how the check is tested without pretending to be a different machine.

  The generated `ONBOARD.md` grows a real room sequence instead of a single paragraph: `plan`,
  `init` after approval, `doctor`, then `dev`, `webhook | sh`, and `daemon` — with the checks
  doctor can name spelled out (`celld`, the `gh webhook` extension, a Linear token, `pi`) and the
  reminder that `hc` is only for `room work`. `JIG.md`'s room section gains the commands it was
  missing and points at `jig room doctor` rather than keeping a prerequisite list that goes stale.

### Patch Changes

- 8799224: Honor an engine's `config`, and stop repeating an engine's own prefix in a rule id.

  `EngineRef.config` was decoded, documented and never used: the root config's
  `"config": "oxlint.config.ts"` worked only because oxlint discovers that file anyway. `argsFor`
  now passes `--config <path>` for `oxlint-plugin` engines. For the others (cutlist, joggle) the
  field stays a pointer, because only oxlint has a flag to put it in.

  A rule id that already carried the engine's own prefix was composed with it a second time:
  `joggle` reports `joggle/import-cycle`, so the report read `joggle/joggle/import-cycle` — a name
  no document uses, that `jig explain joggle/import-cycle` could not find, and that a baseline
  would store. `ruleIdOf` now strips the engine's own prefix from a bare code, the same way it
  already dropped it from oxlint's `plugin(rule)` form, and `unparsed-output` and `stale-catalog`
  are stored unqualified so `${engine}/${ruleId}` composes exactly once.

  `engines.test.ts` pins the rule-id case and the unqualified fallbacks, and the root
  `jig.config.json` now asks the `joggle` engine for tsgo's diagnostics (`--typecheck`) so type
  errors land in the one report.

- d312ebb: `EngineRef` gains an optional `args`, and `jig` resolves an engine from the project.

  A `jig.config.json` engine can now carry the arguments its invocation needs. `jig`'s `plumb`
  engine uses it to scope `oxlint` with `--ignore-pattern`, so a root run never builds a
  neighbouring repo's config (the exemplar's `.oxlintrc.json` names a plugin this workspace did
  not import).

  `jig` also looks for an engine's command in the project's own `node_modules/.bin` before it
  falls back to PATH. The census therefore reports what the project installed, not what the
  caller's shell happens to shadow — the workspace's `joggle` wins over a global install.

- 03726b5: `jig init` drafts vocabulary that says what it is, and picks the root that owns the design
  system instead of the first one alphabetically.

  From the third adopter run (shakti-v2, tackle @ `545925b`):

  - **Architecture is split and not enforced.** A UI root that owns `components/ui`,
    `components`, and `routes` becomes three layers instead of one `services/ui/**` — the
    direction most findings live in is invisible from a single layer. The draft still writes no
    `forbid` and does not claim an order, so `joggle/layer-direction` and `joggle/layer-purity`
    are written `off` with the reason: an alphabetical draft that reports 0 findings reads as a
    clean architecture when nothing was checked.
  - **The prompt mentions it.** `ONBOARD.md` now has the architecture paragraph the cutlist
    draft already had: includes only, order and `forbid` are yours, turn the rules on after.
  - **`tokens` scores the roots.** `:root` in the CSS entry (+3), the custom properties it
    declares, and the colour keys in that root's tailwind config decide which app owns the design
    system; `from` and `vars` are written together and a note names the root left out with its
    numbers (31 tokens instead of 7 on the adopter's two-app repo).
  - **A ledger that can be committed while its rulebook cannot is reported.** `init` now asks
    `git check-ignore` about the configs too, and says when the record would travel without the
    rules that produced it.
  - **`jig engines` names defaults.** With no `jig.config.json`, the table says so instead of
    presenting jig's defaults under a step that reads "confirm every configured engine resolves".
  - **`explain` resolves engine-namespaced ids.** `plumb-effect/require-…` where `plumb-effect`
    is the engine, not a configured engine id, now matches the diagnostic instead of reporting
    "no configured engine named".
  - **Docs name `pnpm exec jig` for machine output.** `pnpm jig check --format json` puts pnpm's
    own engine warning on stdout and corrupts the document.

- d58bb68: Run jig's OpenCode plugin under Node, not the host binary.

  `src/opencode.ts` fell back to `process.execPath` to run this package's own bin. In the
  OpenCode server — a bun-compiled binary — `process.execPath` is OpenCode itself, so the
  fallback ran `opencode bin/jig.js …` and OpenCode printed its help instead of a report. A
  session with no `jig` on `PATH` and no `JIG_BIN` therefore never got a report through the
  plugin's tools.

  The launcher now prefers a `jig` on `PATH`, then this checkout's build, then its source,
  each under a Node found on `PATH` (falling back to whatever runs the host only when no Node
  exists). `resolveLauncher` is a pure function, and `src/opencode.test.ts` pins the decision
  that the byte-parity suite cannot reach because it pins `JIG_BIN`.

- d58bb68: Declare `typebox` as a pi host-provided peer, not a dependency.

  pi 1.2 provides `typebox` to extensions as a host module and refuses to treat it as a
  bundled dependency, warning that an installed copy can bypass the extension loader and
  duplicate the runtime module. Dogfooding the extension in this repo surfaced the warning:
  `typebox` moves from `dependencies` to `peerDependencies` with a `"*"` range (a pinned
  `devDependency` keeps the monorepo's `surfaces.test.ts` resolvable). The earlier decision
  to ship it as a dependency, recorded in `MIGRATION.md` §6, is updated.

- 4723293: Records and lexicons, and per-lexicon versions.

  `@autotelic/protocol` is now a registry of named, versioned record formats rather than four
  loosely-related modules. Every tool-written record carries `lexicon: { name, version }`;
  each lexicon versions on its own line, so `report` can evolve without a reader of
  `baseline` re-reasoning. The global `PROTOCOL_VERSION` is gone; a record written before this
  change (carrying `protocolVersion`) is still accepted by every decoder, forever.

  New in the package: pure defensive decoders for every lexicon (malformed input degrades to
  silence), JSON Schema for `manifest`, `menu`, and `onboarding` (which had none), golden and
  malformed fixtures, a frozen compatibility corpus with `scripts/lexicon-compat.mjs` wired
  into `pnpm check`, a conformance matrix, an independent Node reader, and a language-neutral
  spec for the report → SARIF/LSP/Code Climate projections (`docs/projections.md`).

  `cutlist` writes the catalog and manifest with the catalog lexicon; `jig` writes the baseline
  with the baseline lexicon. Both regenerate their committed exemplar artifacts.

- dc8c013: Declare `typebox` for the pi extension, and prove both surfaces return the CLI's bytes.

  `extensions/jig.ts` imports `typebox` at runtime, but the package declared neither it nor the
  pi types, so the extension could not resolve its own import outside pi's host. `typebox` is now
  a **dependency** (`1.3.34`), the placement the shipped-in-`files` extension needs. The pi types
  stay undeclared on purpose — the import is `import type`, the extension is deliberately not
  typechecked, and declaring the package would pull a large tree in for type-only use. `MIGRATION.md`
  §6 now records that decision instead of leaving it open.

  `src/surfaces.test.ts` closes the loop the brief asks for: it runs the real CLI in a temp repo,
  then drives the pi extension (loaded by computed specifier) and the OpenCode plugin through fake
  hosts, and asserts both hand back exactly the CLI's bytes — with a property over the formats
  OpenCode offers. A second renderer, or a dropped byte, fails the test rather than a user's
  session.

- Updated dependencies [d312ebb]
- Updated dependencies [db85419]
- Updated dependencies [cdca144]
- Updated dependencies [4723293]
  - @autotelic/protocol@0.1.0
