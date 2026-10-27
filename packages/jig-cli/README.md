# @autotelic/jig-cli

**The harness.** The command is `jig`; the package is `jig-cli` only because `jig` was
already taken (an unrelated sibling repo, and the npm name). It owns no analysis. It runs the other engines, merges their output
into one report, and holds the ratchet.

A jig is the fixture that holds a workpiece while several tools work on it: it does not
cut, it holds the piece so the cuts line up. That is the whole job here — run `plumb`,
`joggle`, `cutlist`, and whatever else the repo declares, collect their findings into
one stream, and fail a run only on what is genuinely new.

## It shells out; it does not link

`jig` depends on `@autotelic/protocol` and nothing else in this workspace. It drives
`oxlint` (which carries `plumb`), `joggle`, and `cutlist` **as processes**. That is
deliberate: the cohesion of `tackle` is a shared _format_, not a shared runtime, so the
conductor must not be a fifth thing everything links against.

## One report

Every engine already reduces to the same shape — a place, a sentence, a severity — and
oxlint decided what that looks like. `jig` reads the structured encodings and normalizes
them all:

| Engine kind     | Invocation                   | Encoded as                                          |
| --------------- | ---------------------------- | --------------------------------------------------- |
| `oxlint-plugin` | `oxlint --format json`       | oxlint's JSON (line/column in `labels[0].span`)     |
| `process`       | `joggle check --format json` | a report document, or JSONL                         |
| `cutlist`       | `cutlist build --check`      | a non-zero exit becomes one `stale-catalog` finding |

`jig` asks oxlint for JSON, but it may be handed an engine it did not configure, so it also
accepts the shapes a finding is published in: **SARIF 2.1.0**, the **Code Climate / GitLab**
array (the same shape `jig` projects outward — the read/write loop closes), and **GitHub
Actions annotations**. JSONL is read too. XML (`checkstyle`, `junit`) and human text are
deliberately **not** parsed: guessing at them would be a lie dressed as coverage.

`fixtures/oxlint/` holds all ten of oxlint 1.88's output varieties, and
`src/oxlint-conformance.test.ts` proves which are read and that the rest become findings
rather than silence.

oxlint names a rule `plugin(rule)`, so the report must not repeat the engine: on engine
`plumb`, `plumb(no-raw-html-layout)` is ruleId `no-raw-html-layout`
(`plumb/no-raw-html-layout`, not `plumb/plumb(...)`), while a sub-plugin keeps its namespace
(`plumb/plumb-ui/no-raw-interactive`).

An engine that speaks none of these is **not** silently treated as clean: it produces one
`<id>/unparsed-output` info finding, because "no findings" and "not understood" must never
look the same.

The same rule runs one level up. A report distinguishes what an engine **found** from what
it **did**: an engine that replayed a cache, skipped a rule, or left candidates unjudged is
marked `replayed`, `skipped`, or `<n> candidate(s) not judged` in the census, so `0 finding(s)`
never stands in for "clean". A finding carries its judged provenance when it has one — the
entropy `move`, a `score`, and whether an engine actually judged it — and that provenance
rides out through every projection below.

## Reading the vocabulary

`jig check` enforces the tree; `jig menu` reads the cutlist artifact without importing
cutlist. No query prints the stable shape and the files; `jig menu dialog` ranks the parts,
features, and recipes that answer a concept and returns the import and next shape. The pi
extension exposes the same command as `jig_menu`, the OpenCode plugin as `jig.menu`, and both
expose the setup prompt as `jig_onboard` / `jig.onboard` and the applying step as
`jig_init` / `jig.init`. This is
how the menu reaches an agent without turning the agent into a second renderer: cutlist writes
the artifact, jig reads it at the seam.

## Outward projections

A finding does not leave the workspace in the report's shape; it leaves in the shape the host
ingests. Each is a pure projection of the one report, specified in
`protocol/docs/projections.md` and frozen against worked examples. The text form is the one
human renderer — the pi extension and the OpenCode plugin hand a model that same text rather
than re-rendering it.

| `--format`    | Target                                      |
| ------------- | ------------------------------------------- |
| `text`        | the human report (default)                  |
| `json`        | the report document, verbatim               |
| `jsonl`       | one finding per line, the streaming form    |
| `github`      | GitHub Actions workflow annotations         |
| `sarif`       | SARIF 2.1.0 for code scanning and IDEs      |
| `lsp`         | LSP 3.17 diagnostics (0-based), for editors |
| `codeclimate` | Code Climate / GitLab Code Quality issues   |

## The ratchet

The gate is `protocol`'s baseline: findings are accepted **by identity**, never by line.
A run fails on new identities only. `warn` repo-wide and `error` on what you touched is
the same file, not a second configuration.

```sh
jig check                    # run every engine; fail on errors and new findings
jig check --format sarif     # SARIF 2.1.0 for code scanning
jig check --limit 20         # the census, then the first 20 findings
jig baseline                 # accept the current findings into the baseline
jig engines                  # what is configured, and whether it is on PATH
jig menu                     # the cutlist stable shape and artifact files
jig menu dialog              # the parts, features, and recipes that answer a concept
jig init                     # inspect the repo, then write the harness it can run
jig init --gate all          # the same, enforcing every finding from the first run
jig init --print             # the same plan and agent prompt, writing nothing
jig onboard                  # just the setup prompt for an agent
jig onboard --gate all       # the prompt, planning a repo-wide gate
```

From this workspace, `pnpm install` links the package into the root `.bin`, so
`node_modules/.bin/jig` is the built CLI; `pnpm jig` runs the source instead.

## `jig init` reads before it writes

A scaffold that writes the same four files everywhere is a template, not an
onboarding. `init` inspects the repository first:

- the package manager, from `packageManager` or the lockfile;
- the oxlint gate the repo already runs, preferring a script that names a config
  and a strict name (`lint:errors` over a broad advisory `lint`);
- whether that config actually loads `@autotelic/plumb`, so the `plumb` engine
  is not a misnamed oxlint;
- whether `joggle` and `cutlist` are installed, and whether the repo has a
  tsconfig or a `cutlist.config.json`;
- the agent docs already present, which are left untouched.

It enables only engines that can run, writes a starter `joggle.config.json` with
`unavailable: "count"` when joggle is enabled, and defaults the gate to
`touched-files`: existing debt is reported, not enforced, until someone touches
it. `--gate all` opts into the repo-wide ratchet. The generated `JIG.md` and
`ONBOARD.md` are specific to the profile, and the summary names what was kept,
what was written, and the next two commands.

`touched-files` is the adoption default, but it is the wrong gate for validating a
clean checkout: the working-tree diff is empty, so the touched set is empty, and a
run can exit 0 while the report lists findings. For a first run, a workshop, or CI
on a clean PR checkout, pass `--gate all` — or `gate: "all"` to `jig_onboard` /
`jig.onboard` and `jig_init` / `jig.init`. The plan's next command carries the gate
it chose, so the applied config matches what was approved.

`jig init --print` and `jig onboard` are the agent door: they run the same
inspection but write nothing, and print the prompt with the plan's engines,
notes, and stop-and-ask points. `--format json` returns the same plan as data,
and `--gate` / `--force` choose the plan's gate and whether existing files would
be rewritten. The pi tool `jig_onboard` and the OpenCode tool `jig.onboard` are
the same command, and `jig_init` / `jig.init` apply the plan after a human
approves it — with the same `gate` and `force` options.

Cutlist is opt-in because its config is the repository's vocabulary, not a
generic default. When the tree looks like a UI, `init` says so and nothing more.
`jig init --cutlist` drafts `cutlist.config.json` from the detected roots
(components, routes, tailwind/theme source, tsconfig path aliases), then asks the
operator to review it, run `cutlist build`, commit the catalog, and re-run
`init --force` to enable the engine. A draft is never enabled before someone has
looked at the vocabulary it inferred.

Re-running is safe. It keeps existing files; `--force` rewrites the config and
the two docs, but never the accepted baseline.

## Where it sits

`cutlist` **produces** the vocabulary; `plumb` and `joggle` **consume** it; `jig` runs
all three and keeps the ledger. It is also the surface pi and OpenCode call, so an agent
gets the same findings a human's terminal does.
