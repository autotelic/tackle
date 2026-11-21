# The worker seam: workstream → Treadle config

The kernel spawns Treadle as a process each pass. This is the mapping, the conversions that mapping needs, and
what is deliberately kept out.

**The config is generated per pass and written outside the worktree** — `~/.factory/configs/<id>-<pass>.ts`. Never
into the repo: a config file appearing mid-pass dirties `git status`, and the next checkpoint would commit it.

---

## 1. The mapping

Treadle's own `LoopConfig` (`packages/treadle/src/config.ts`) is the target type; the validator there is the
contract, not this table.

| workstream                     | treadle `LoopConfig`            | conversion                                                                                                               |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `worktree`                     | CLI `--repo`, not config        | absolute path, as adopted                                                                                                |
| `checks[]`                     | `checks: CheckStep[]`           | **↑ each string becomes `{ name, run, timeoutSeconds }`** — see §2                                                       |
| `desired.install`              | `install` (required)            | default `"true"` when absent, and the receipt records the default                                                        |
| `budgets.wallMinutesPerPass`   | `budgets.sessionTimeoutMinutes` | direct                                                                                                                   |
| `desired.dollarCeilingPerPass` | `budgets.maxCostPerSessionUsd`  | direct, optional                                                                                                         |
| `desired.dollarCeilingPerDay`  | `budgets.maxCostPerNightUsd`    | direct, optional                                                                                                         |
| `desired.model`                | `model`                         | direct, optional; absent = pi's default                                                                                  |
| `desired.integrationBranch`    | `integrationBranch`             | direct, optional; absent = per-PR flow                                                                                   |
| `repo`                         | `issues.tracker`                | `"github"` when the workstream's PR lives on GitHub                                                                      |
| `label`                        | `issues.ready/working/parked`   | **synthesized**: `<label>`, `<label>:working`, `<label>:parked` — treadle needs three states, a workstream has one label |
| —                              | `issues.dir`                    | only for `tracker: "markdown"`, generated outside the tree                                                               |
| —                              | `protectedPaths`                | from `desired.protectedPaths`, default `[]`                                                                              |
| —                              | `featureDone`                   | `{ changedPaths: desired.changedPaths ?? [], requireNewTests: true }`                                                    |

---

## 2. The three places the shapes differ, and what to do

**① `checks: string[]` → `CheckStep[]`.** Treadle requires `name`, `run` and a `timeoutSeconds` per step. A bare
command has no timeout, and inventing one silently is how a check hangs for an hour. So: a check string may carry
an explicit timeout (`"pnpm test" : 900`), and a check with no timeout **refuses** at config generation
(`CheckWithoutTimeout`, exit 2, naming the check). Defaulting the timeout would make the kernel the author of a
bound the operator never chose.

**② Per-phase budgets do not cross the seam.** Treadle's budgets are per issue and per session; the workstream's
are per phase. Mapping one onto the other loses either the phase or the session meaning, so:

```
kernel keeps   passesPerPhase, roundsOfChanges, tokensPerDay     (it counts those itself)
treadle gets   sessionTimeoutMinutes, maxCostPerSessionUsd, maxCostPerNightUsd,
               passesPerIssue (for the one ticket it was given), stallAfterFlatPasses
```

The kernel is the only thing that knows the phase budget, and it caps by not starting a pass. This is the reason
the kernel owns lifetime — passing `passesPerPhase` down as `passesPerIssue` would make a phase look like a ticket.

**③ Tokens are not dollars.** `budgets.tokensPerDay` has no treadle equivalent; Treadle measures spend in dollars.
So the kernel enforces the token cap on its own accounting and passes a _dollar_ ceiling only when the operator set
one. Converting tokens→dollars inside the seam would put a price table in the adapter, which is the same class of
mistake as a lease generation without its lease id: a number whose unit nobody wrote down.

---

## 3. Deliberately not passed

| field      | why not                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `phase`    | a worker is given one task; the phase lives in the kernel, and a worker that knows its phase starts deciding                        |
| `cursors`  | there is no event rewind inside a pass; passing cursors invites the worker to “catch up”                                            |
| `lease`    | a worker must never believe it owns the workstream — the fence is the kernel’s, and a worker holding a lease would try to defend it |
| `desk`     | a desk item is a kernel/kernel-UI concept; a worker _produces_ one, it does not read the queue                                      |
| `deps`     | the DAG is scheduling, and scheduling is the kernel’s. A worker with `deps` would wait instead of exiting                           |
| `autonomy` | autonomy is enforced by the kernel’s tool policy on the way out; passing it down creates a second policy engine that can disagree   |
| `rules`    | Treadle’s rules engine stays Treadle’s; the kernel does not generate rules, or we have two policy vocabularies                      |
| `pr`       | a worker comments on a PR it can discover; it does not get merge authority by being told the number                                 |
| `sow`      | the SOW is authored intent and is read-only everywhere                                                                              |

---

## 4. The one behavior that keeps the tracker from drifting

Treadle can _pick_ an issue (`issues.tracker` + queue). The kernel must never let it: **the kernel supplies the
issue for the pass** and treats Treadle as a single-ticket executor, because the workstream’s queue is the DAG
(§6 of `docs/workstream.md`), not a repository’s open issue list. Concretely: the generated config names the
tracker for labels/links, and the kernel passes the issue explicitly; a pass must fail loudly if Treadle selects a
different ticket (`TicketMismatch`), rather than silently working the wrong one.

---

## 5. Acceptance

1. **Treadle’s own validator accepts the generated file.** The seam’s test is `parseConfig(generated)`, not our
   reading of the table — so the mapping cannot drift from the tool it configures.
2. **The file never appears in `git status`** of the worktree: generate into `~/.factory/configs/`, assert
   `git status --porcelain` is unchanged after a pass.
3. `CheckWithoutTimeout` fires for a bare `"pnpm test"`, and passes with `"pnpm test" : 900`.
4. The two real workstreams generate configs that both validate, and the receipt records every defaulted field
   (`install`, `protectedPaths`, `featureDone`).
5. **Nothing in the generated file mentions a lease, a phase, a cursor or a desk.** Grep the artifact; a field
   that crossed the seam by accident is how the worker starts thinking it owns the workstream.
