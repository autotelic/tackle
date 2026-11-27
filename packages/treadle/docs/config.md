# loop.config.ts reference

The config is a typed module, not JSON: it is loaded by the Loop and validated at
startup (`src/config.ts`), so a bad key fails loudly before the first pick. This page is
the prose companion — what each field is *for*, and which ones bite when left unset.

Minimal, working:

```ts
export default {
  issues: { tracker: 'markdown', dir: '/Users/me/Projects/demo-tracker', ready: 'ready', working: 'working', parked: 'parked' },
  install: 'npm ci',
  checks: [{ name: 'unit', run: 'npm test', timeoutSeconds: 600 }],
  protectedPaths: ['loop.config.ts'],
  featureDone: { changedPaths: ['src/**'], requireNewTests: true },
  budgets: { passesPerIssue: 4, stallAfterFlatPasses: 2, maxTurnsPerSession: 300, sessionTimeoutMinutes: 60, askHumanTimeoutMinutes: 30, stopAfterParkedInARow: 3 },
}
```

## Required

| Field | What it does |
|---|---|
| `issues` | The tracker. `tracker: 'github'` labels issues; `'markdown'` reads a directory of files (see [markdown-issues.md](./markdown-issues.md)). |
| `install` | Run in the worktree before Checks. Not a check: this asks whether the harness can run at all. |
| `checks` | The gate, as ordered steps. `report: { format: 'vitest-json', path }` makes a step's test count the unit the Feature done guard ratchets. **`path` is resolved from the repo root**, while the step's own `cd` decides where the tool writes — a path written relative to a package directory reads as `report-unreadable`. |
| `protectedPaths` | The Session may not leave these changed; `revertProtected` restores them before a Checkpoint. Put the harness itself here: the gate is what the Loop trusts. |
| `featureDone` | `changedPaths` in which real work must appear, and whether the unit count must grow. |
| `budgets` | See below. |

## Optional, and the ones worth setting

| Field | Why |
|---|---|
| `integrationBranch` | ADR-0003: the Loop squash-merges its own green PRs here; humans review this branch into the default branch once. Without it, PRs target the default branch and a person merges each. |
| `model` | `{ provider, id }`. Absent = pi's configured default. |
| `build` | Run after `install`, before Checks, in the worktree. For a repo whose checks need `dist/`. |
| `app` | How to start the app for checks with `needsApp: true`. |
| `rules` | `(event, state, guard?) → action`, first match wins. The seed pair (fix-checks on failure, mark-ready on `feature.done`) is what most repos want. |
| **`generatedPaths`** | Paths the repo *regenerates* rather than edits — a compiled catalog, a generated menu. A conflict on one takes the integration side and the branch's own Checks regenerate it. Without this, a generated artifact is reported as a source conflict and stops the stack. |
| **`sessionsKeepDays`** | Prune `.treadle/sessions/` past N days. Absent keeps everything; transcripts reach GBs quickly. An **open** issue's newest transcript always survives (re-entry distils it). |
| `protectedPaths` beyond the harness | Anything an over-eager Session should not touch: migrations, `.github/workflows`, the briefs. |

## Budgets

| Field | Meaning |
|---|---|
| `passesPerIssue` | Passes an issue may spend. A Pass that shrinks the Failure set is progress-exempt. |
| `stallAfterFlatPasses` | Park after this many passes with no shrinking Failure set. |
| `maxTurnsPerSession`, `sessionTimeoutMinutes` | Per-Session backstops. Reaching them means the real caps failed to fire. |
| `askHumanTimeoutMinutes` | How long a blocked Session waits for an answer before parking. |
| `passesPerNight` | **Optional.** A Pass is a proxy for the money it costs: one observed run stopped at 24 passes having spent $2.53 of a $40 budget. With `maxCostPerNightUsd` set, leave this out and let the dollars bound the night. |
| `maxCostPerSessionUsd`, `maxCostPerIssueUsd`, `maxCostPerNightUsd` | Dollar caps, checked against the Session's own accounting. The nightly one is the real bound; it survives restarts and rolls over at local midnight. |
| `stopAfterParkedInARow` | Circuit breaker: three consecutive parks means the queue is asking for a person, not for more passes. |
| `maxOpenLoopPrs` | The wave rule: stop picking while this many `loop/*` PRs await review. With an `integrationBranch` this is redundant — the pile drains itself. |

## Reading a run

`npm run stats -- --repo <loop clone>` prints per-issue passes, turns, dollars and active
minutes, plus mean/median per issue and how many passes had a transcript. Use it before
changing a budget: the mean and the median differ by an order of magnitude, and the cap you
care about is almost never the one that stopped the run.
