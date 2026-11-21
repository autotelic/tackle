# The workstream

The contract. `docs/factory-plan.md` is the route and the acceptance tests; this file is what the code must
satisfy: the object, the refusals, the checkpoint, the worker seam, and what we are allowed to claim.

---

## 1. The object

One record per workstream, written **outside** the tree it governs.

```jsonc
// ~/.factory/workstreams/<id>.json   — never inside the repo
{
  "id": "perms-1862", // stable; the lease key and the checkpoint prefix
  "project": "P-AUT-128", // Linear project
  "label": "permissions-overhaul", // GitHub label
  "repo": "Shakti-Reforestation/forestbuilder",
  "path": "/Users/togmund/autotelic/shakti-perms", // adopted, never moved or rewritten
  "branch": "feature/permissions-overhaul",
  "head": "55aa5293a", // HEAD at last observation
  "pr": 1862,
  "baseSha": "<develop-at-adoption>", // the base COMMIT; a ref name is display only
  "deps": [], // workstream ids; the queue is a partial order
  "phase": "reconcile",
  "lease": { "holder": "macbook", "generation": 1, "expiresAt": "…" },
  "cursors": { "github": "…", "linear": "…" }, // replayable, opaque strings
  "budgets": {
    "passesPerPhase": 5,
    "wallMinutesPerPass": 30,
    "tokensPerDay": 0,
    "roundsOfChanges": 2,
  },
  "autonomy": ["comment", "label", "push", "pr-body", "rebase", "ci-fix"],
  "desk": [],
  "checkpoint": { "sha": "…", "ref": "refs/bench/<id>", "at": "…", "pushed": true },
}
```

Two rules about the file itself:

1. **Outside the governed tree.** `.room` or `.factory` inside the repo dirties `git status` and
   `git clean -xdf` deletes it. The repo holds code and checkpoint refs; nothing else.
2. **The record is the phase's home, not the journal.** The phase, cursors, budgets and lease must be
   readable and diffable by a human after a crash. A SQLite page is not.

---

## 2. Invariants

Each is a sentence a test can fail.

| #   | invariant                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------- |
| 1   | A worker session can exit at any moment; the workstream record survives it.                               |
| 2   | Adoption is a state transition: the worktree path never changes.                                          |
| 3   | One live lease per workstream; one live grant per `(repo, pr)`.                                           |
| 4   | A worker pass ends in a checkpoint **or** a desk item, never in an open session.                          |
| 5   | Durability is claimed only to the last verified checkpoint.                                               |
| 6   | The SOW and the merge belong to a human: the worker may propose, never perform.                           |
| 7   | Events are the clock: poll cursors are the truth, webhooks only accelerate them.                          |
| 8   | A cap-stop is a state (`blocked: budget`), not a crash and not a retry.                                   |
| 9   | A pass is charged **when it starts**; one that dies before its checkpoint is a charged, interrupted pass. |

---

## 3. Adoption refusals

Adoption is where a second writer is created by accident, so every refusal is named, exit-coded, and
proved by a test. **One query per refusal** against the store.

| code           | condition                                                        | message names        | exit |
| -------------- | ---------------------------------------------------------------- | -------------------- | ---- |
| `NotAWorktree` | `git rev-parse --is-inside-work-tree` fails at the path          | the path             | 1    |
| `PathOwned`    | another live workstream names this `worktree`                    | that workstream's id | 1    |
| `PrOwned`      | another live workstream names this `pr`                          | that workstream's id | 1    |
| `ProjectBusy`  | another live workstream names this `project`                     | that workstream's id | 1    |
| `HeadMismatch` | `branch` head ≠ the PR's `headRefOid`                            | both shas            | 1    |
| `DirtyTree`    | uncommitted changes present **and** `--no-checkpoint` was passed | the file count       | 1    |
| `DetachedHead` | HEAD is detached                                                 | the sha              | 1    |

Two notes that are easy to get wrong:

- **Same path or same PR is the same bug** (two owners), but they are separate refusals because the message
  must name _which_ owner was found. A single “already owned” error sends the operator looking in two places.
- **`DirtyTree` does not refuse adoption by default** — it checkpoints what is dirty and records it. Refusing
  uncommitted work is how you train people to stash before adopting, which loses the evidence of what they
  were doing. The refusal exists only for `--no-checkpoint`, where the operator explicitly asked for a clean
  copy.

Adoption then captures, in one record: `head`, `dirtyFiles[]` (paths + status), `prHead`, `label`, `baseSha`,
and the inferred phase (see §5).

---

## 4. Checkpoint

Per **pass**, on idle, and before any move. Never per turn: a system that pushes every turn makes pushes the
loudest thing in it, and everyone learns to ignore them.

```sh
# worktree: content-addressed, diffable, mergeable, off-machine
 git add -A && git commit -m "factory: checkpoint <id> pass <n>" \
   && git push origin HEAD:refs/bench/<id>

# journal: consistent while the writer is OPEN (no quiesce needed)
 sqlite3 journal.db "VACUUM INTO '/tmp/<id>-pass-<n>.db'"

# receipt: what makes the copy resumable rather than just recent
 { workstream, pass, at, headSha, checkpointSha, cursors, checks[], desk[], workerExit }
```

- **Never `stash`** — local-only and droppable.
- **Never copy a live journal file** — `VACUUM INTO` is the supported online backup; a `cp` of a live SQLite
  file is a torn copy that reads as corruption later.
- **The receipt is part of the checkpoint.** A checkpoint without cursor watermarks is a copy that replays
  work; without checks it is a copy that forgets what passed.
- **Verify on restore**: the receiving shop recomputes the checkpoint sha and refuses on mismatch
  (`blocked: divergent`), never merges two histories.

---

## 5. The worker seam

Treadle remains the worker runner. The kernel spawns it as a **process**, passes a config file, and reads the
receipts directory. No module is shared, so either side can be replaced.

**A pass is spend, not outcome: it is charged when it starts.** Charging it when it ends in a desk item would
make indecision free and make failure look cheaper than progress. A pass that starts and dies before writing a
checkpoint is still charged, and is recorded as an interrupted pass.

```
kernel ──spawn──▶ treadle --config <generated>.ts --repo <worktree>
                         │
                         └─▶ receipts/<pass>.json ──▶ kernel's event feed
```

| the kernel owns                                         | treadle owns                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| phase, cursors, deps, budgets, desk, lease, checkpoints | one session, deterministic checks, checkpoint on failure, receipt, per-pass budgets |

What the kernel must add because Pi goal mode is absent: **resume after death** (journal + checkpoint) and
**a stop condition** (phase `done`, and `blocked: budget`). Nothing else from goal mode is needed.

---

## 6. Phases

```
adopted → reconcile → build → land → done
                    ↘ blocked ↗   (desk answer returns to the phase that blocked)
```

| phase       | entered when                              | allowed without a desk item                               | exits on                             |
| ----------- | ----------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| `adopted`   | adoption succeeded                        | capture state, checkpoint                                 | inference complete                   |
| `reconcile` | Linear state and branch evidence disagree | read-only report; Linear **proposals**                    | desk accepts the report              |
| `build`     | tickets remain and a grant is not needed  | commit, push, checks, comments, labels, rebase, ci-fix    | all leaves verified by checks        |
| `land`      | review is the queue                       | make mergeable: checks, conflicts, description, reviewers | a live land grant (`docs/lander.md`) |
| `blocked`   | a decision is needed                      | nothing                                                   | the desk answer                      |
| `done`      | the phase's own definition of done holds  | archive the checkpoint                                    | —                                    |

Two rules the table encodes: **`reconcile` never writes** to Linear (proposals only, see
`docs/reconcile.md`), and **`land` never merges** — merging is the lander's grant, and the worker is not the
lander.

---

---

## 7. Status

The one surface a human and a script both read, so the rule is: **text has no fact the JSON lacks**, and the JSON
has no sentence.

```jsonc
{
  "schema": 1,
  "at": "2026-11-21T22:50:00Z",
  "workstreams": [
    {
      "id": "perms-1862",
      "phase": "build",
      "pr": 1862,
      "head": "55aa5293a",
      "blockedBy": [],
      "checkpoint": { "sha": "…", "pass": 7, "at": "2026-11-21T22:38:00Z", "ageSeconds": 720 },
      "observed": { "github": "…", "linear": "…", "ageSeconds": 180 },
      "freshness": "fresh",
      "desk": { "open": 2 },
      "budget": { "passes": { "used": 3, "of": 5 }, "capStop": null },
    },
  ],
}
```

Five rules the fields exist to enforce:

1. **Checkpoint age is observed, never described.** `ageSeconds` is computed from `checkpoint.at`; the words
   `durable` and `safe` never appear in any output. A crash loses everything after that age, and the output
   should say the age rather than reassure.
2. **`freshness` is three-valued, and the difference is whether anyone looked:**

   | value        | meaning                                                   |
   | ------------ | --------------------------------------------------------- |
   | `fresh`      | observed within the window                                |
   | `stale`      | observed, but older than the window                       |
   | `unobserved` | no cursor has advanced since adoption — nobody has looked |

   Collapsing `unobserved` into `stale` is the quiet-number problem at the top of the product: “nothing
   happened” and “nobody looked” become one line.

3. **`blockedBy` names ids**, never a boolean. `[]` is the only way to say unblocked.
4. **`capStop` is a state with a reason** (`passes` | `wallMinutes` | `tokens` | `rounds`) or `null`. A capped
   workstream must never look idle. Where a number is unknown, the field is `null` — never `0`.
5. **Text is the sentence, JSON is the fields.**

```
perms-1862 · build · PR 1862 · checkpoint 12m ago · observed 3m ago · 2 desk items
perms-1862 · land  · PR 1862 · checkpoint 12m ago · NOT OBSERVED since 2026-11-21T20:00Z · 1 desk item
perms-1862 · blocked: budget (passes 5/5) · PR 1862 · checkpoint 1m ago · observed 1m ago
```

The middle line is the one worth writing correctly: it is a _warning made of facts_, not the word `stale`.

---

## 8. Cursors

A cursor is stored as an **instant in epoch milliseconds**, plus the source's original string for display. The
string is never compared.

Why, concretely — Linear returns `updatedAt` as ISO-8601 with an offset, GitHub returns `Z`, and lexical
comparison of those strings skips events the moment an offset differs:

| event | string                      | instant | lexical rank | true rank |
| ----- | --------------------------- | ------- | ------------ | --------- |
| e1    | `2026-11-21T09:00:00+02:00` | 07:00Z  | 2nd (latest) | 1st       |
| e2    | `2026-11-21T07:30:00Z`      | 07:30Z  | 1st (oldest) | 2nd       |
| e3    | `2026-11-21T03:00:00-05:00` | 08:00Z  | 3rd          | 3rd       |

A cursor holding e1's **string** sorts after e2's, so a `since=<string>` poll skips e2 — an event that is later
in time. Nothing errors; an issue simply never gets picked up. That is the fixture: given these three events and
a cursor at e1's instant, one poll returns **e2 and e3** and a second poll returns nothing.

Four rules:

1. **Parse to an instant, compare instants.** Keep the raw string only for display and for a request body.
2. **Overlap the window and dedupe by id.** `since = lastInstant - 5s`, and drop any event whose id was already
   applied. `>` versus `>=` plus clock skew is a boundary bug that only shows up as a missing event.
3. **A cursor may not go backwards.** If a run computes an earlier instant than the stored one, that is
   `CursorRegressed` at exit 2 with both values — never a silent rewind, or the same event is applied twice
   under a different id.
4. **One normalizer for both sources.** GitHub's `Z` and Linear's offset are the same problem; two
   implementations means one of them is wrong and nobody knows which.

## 9. What we may claim

> **Recoverable:** the last checkpoint is off-machine; any shop can adopt at `generation + 1` and lose at most
> the work since that pass. **Not failover:** a human, or the org bench with a one-click desk item, decides when
> to adopt.

A crash loses everything after the last checkpoint, including an in-flight pass. Say so in `factory status`:
the line is `checkpoint 12m ago`, not `durable`.

Failover becomes claimable when a second shop is running **and** the authority grants `g+1` without a human —
both, not either. Until then, “assisted recovery” is the honest phrase.

---

## 10. Open

- **Container timing.** Before the two projects run, or after the kernel proves the loop on worktrees? The
  adoption path must be identical either way, which is what makes deferring it safe.
- **Cursor encoding.** Opaque strings today; GitHub `since` timestamps and Linear `updatedAt` differ enough that
  a shared type would be a lie.
- **Cursor `since` semantics for Linear.** `updatedAt` compares lexically with a timezone offset; the poller
  must normalize before a cursor can be trusted monotone.
