# @autotelic/jig-cli

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
