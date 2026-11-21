# Factory test fixtures

Data only: no TypeScript, nothing that runs by itself, no network. Each file exists because it can fail in a way
nobody notices, and each is read by a test that asserts on **structure**, not on prose.

Tests consume these as `JSON.parse(readFileSync(...))`. The seam fixtures are validated by calling
`treadle`'s own `assertLoopConfig` on the parsed object (with `_generated` stripped), so the mapping cannot drift
from the tool it configures.

---

## cursor/

| file                      | proves                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `linear.offset-pair.json` | A cursor compared as a **string** silently skips an event when an offset differs. `09:00+02:00` sorts _after_ `07:30Z` while being _earlier_; a `since=<string>` poll answers “nothing new” with two events pending. Also shows the opposite failure (duplicate replays) from a different starting point, and that the instant-backed cursor gives the right answer for **both**. |
| `github.offset-pair.json` | The **control**. GitHub serializes UTC with `Z`, so lexical ordering agrees with instant ordering here — a normalizer exercised only on this file passes while Linear is broken. Same code path, same expectations.                                                                                                                                                               |

Each file carries `cases[]` with `cursor`, `since`, what a string comparison returns, and `mustReturn`. The
normalizer's test iterates the cases; the `why` field is for the human reading a failure.

## events/

The shared normalized envelope, which the poller, the inbox and the desk all speak:

```jsonc
{
  "id": "<source>:<kind>:<native id>",
  "source": "github" | "linear",
  "kind": "review.comment" | "issue.created" | "project.updated" | …,  // dotted, like a receipt
  "at": "<instant, Z>",                     // never an offset; the same rule as cursors
  "subject": { … },                         // repo/pr/path/line, project/issue, project/field
  "actor": "<login>" | null,
  "body": "…" | undefined,
  "headSha": "…" | undefined,               // what the event was authored against
  "dedupeKey": "<stable across polls>"
}
```

| file                          | proves                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github.review-comment.json`  | A review comment wakes exactly one pass, and the receipt names the event id **and** the `headSha` it was authored against — otherwise a comment on an old head looks actionable.        |
| `linear.issue-created.json`   | A new ticket wakes `reconcile`, not `build`: “a ticket appeared” is not “start coding”, and the phase decides what it means.                                                            |
| `linear.project-updated.json` | The SOW-adjacent event. It may **propose** a desk item and **never** write the description — `policy.mayEdit: false` in the fixture, `SowEdit` in `docs/refusals.md` if anything tries. |

## seam/

The generated Treadle config for each of the two live workstreams, exactly as `docs/seam.md` maps it.

| file                           | notes                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `permissions-1862.config.json` | Two checks with **explicit timeouts**; `install` and `protectedPaths` recorded as defaulted; session budgets only.                |
| `enterprise-1854.config.json`  | Three checks (includes e2e at 3600s) and `integrationBranch`, because the phase is `land` and the PR targets a long-lived branch. |

Both pass `assertLoopConfig` today. `_generated` is the only non-config key and the test strips it before
asserting; it records the workstream, the pass, what was defaulted, and what was deliberately kept out.

## status/

Three files, one per `freshness` value, each carrying **both renderings** (`json` and `expectedText`) so the test
can assert parity: text may not contain a fact the JSON lacks, and the JSON may not contain a sentence.

| file              | proves                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fresh.json`      | the ordinary case: a healthy workstream still reports checkpoint **age**, never a reassuring word                                                                                                        |
| `stale.json`      | stale plus a cap stop. `capStop: "passes"` with 5/5 must render as a cap stop, because a capped workstream that reads as idle is the failure we keep naming                                              |
| `unobserved.json` | `checkpoint: null`, `observed: null`, and `blockedBy: ["integrations-1860"]`. Nobody has looked, so the text says **NOT OBSERVED** — the one value a boolean freshness flag silently merges into “stale” |

Each file's `assertions[]` is the list the test should encode, including the three cheap rules:
`checkpoint null` is “no checkpoint yet” and never `0m`; `observed.x: null` is “never” and never `0m`; `blockedBy`
renders the **id**, never a bare “blocked”.

## checkpoint/

| file                       | proves                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `receipt.ok.json`          | a completed pass: `chargedAt == startedAt`, cursors and `consumedEvents` present, and one check with `ran: false, ok: null` that must render as _not looked at_ |
| `receipt.interrupted.json` | a pass killed before its checkpoint: **still charged**, `checkpointSha: null`, cursors from _before_ the pass so a restart re-reads exactly what it lost        |
| `divergent.json`           | a restore whose bytes differ: `blocked: divergent`, **both** journal and head hashes, `merged: false`, the quarantine path, and the new generation              |

The `divergent` fixture is the one that keeps “quarantine, never merge” from decaying into a code comment: every
fact a human needs to answer “what happened to those two commits” is in the record.

## lander/

| file            | proves                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grant.json`    | one batch, two entries, one per `checkMode`, and **no ref names anywhere**; `facts` beside it carries the observation a merge re-checks (suite head sha, PR head, merge parents) so a test asserts the lander _reads_ rather than trusting the grant |
| `refusals.json` | four cases — `ContentChanged`, `EquivalenceUnavailable`, `UntestedMerge`, `WrongPair` — each with the facts, the expected outcome and what the desk item must show                                                                                   |

The last two are the pair a plausible implementation confuses: “the PR is green” and “**the pair we approved** was
tested” are different claims, and only the second authorises a merge.

## watch/

`wake-cases.json` — six cases: **two that must wake, four that must not**, and every “must not” names its reason,
because a silent non-wake is indistinguishable from a broken poller.

| case                  | wake    | why                                                                                                                                                                                                                                            |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stale-head-review`   | **yes** | a comment authored against an older head still critiques the change; suppressing it loses a human's comment. The pass gets `authoredAgainst` **beside** `currentHead`, and the receipt records `headMismatch: true` — line numbers may not map |
| `current-head-review` | **yes** | the ordinary wake                                                                                                                                                                                                                              |
| `already-consumed`    | no      | the same event id in an overlapping poll window. Without this every wake doubles                                                                                                                                                               |
| `self-authored`       | no      | the poller sees the foreman's own comment next tick; waking on your own output is an infinite loop with extra steps                                                                                                                            |
| `blocked-on-desk`     | no      | recorded, not started: a pass running while a human decision is pending contradicts the answer it is waiting for                                                                                                                               |
| `cap-stopped`         | no      | recorded, with the reason naming the dimension and the counts (`passes 5/5`), never the word “blocked”                                                                                                                                         |

The stale-head case is the one worth arguing about, and the fixture states the argument: **wake and record the mismatch**,
because losing a review is the worse failure, and a pass that does not know the head moved will assume line numbers
that no longer exist.

## queue/

`dag.json` — the queue as a partial order. Permissions depends on nothing and blocks four; Documentation Files blocks
Projects List; Enterprise is parallel. It carries `expectedOrder`, `expectedRows` (with `blockedBy` as a **list** of
every unshipped dependency), and four refusals:

| refusal               | message shape                                                                         |
| --------------------- | ------------------------------------------------------------------------------------- |
| `BlockedByDependency` | `projects-list is blocked by documentation-files` — one hop, and it names the blocker |
| `AlreadyLive`         | `perms-1862 is already live on macbook (generation 3)`                                |
| `DependencyCycle`     | `dependency cycle: a -> b -> c -> a` — a cycle reported as “blocked” hides forever    |

The file is self-checking: `expectedOrder` must contain every unshipped workstream exactly once, contain no shipped
one (“integrations-1860” is shipped and appears in no row), and place nothing before a dependency it needs. A tie is
broken by project id ascending — declared, because “whatever order the store returned” is how a queue becomes
non-deterministic.

## desk/

`items.json` — the four things a workstream can ask a human, plus one that is not a question:

| id          | kind     | what it pins                                                                                                                                |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `desk-b7c1` | approval | the batched land item: rows carry diffstat, jig counts, test state and whether the base moved — the artifact, not a verdict                 |
| `desk-a4f9` | approval | the reconcile report: rows split by `confidence`, so “apply the 26 evidenced” and “apply all 35” are visibly different decisions            |
| `desk-c2e0` | decision | a genuine choice (one PR vs split) with a `suggest`, because a human reading an item should see what the foreman would do                   |
| `desk-d5a3` | blocked  | `quality-regressed`: jig 0/0 → 0/3, the pass checkpointed but **not accepted**, and three ways out including `revert` and `accept-baseline` |
| `desk-e8b2` | fyi      | not a question; answering it is `UnknownOption`                                                                                             |

`answers.json` — the records: a first answer, a **second human answering the same item** (recorded with
`supersedes`, never dropped), a partial selection, and a revert. Plus four cases: `UnknownOption` for an fyi item,
`UnknownOption` for a row not in the group, `ItemExpired`, and the one that is not an error — re-answering with the
same value is **idempotent** and returns the existing record, because a double click is not a conflict.

## report/

`factory-report.json` — the P4 seam from a Shakti foreman to the Tackle workstream. Three examples
(`ergonomics`, `conformance`, `blocker`) and a shape that survives the transport: `command`, `expected`, `actual`,
the interesting line as `output` (full text as a ref, never inline), `evidence`, `blocked`, and a stable
**`fingerprint`** so a repeat is counted rather than re-triaged.

## apply/

`receipts.json` — `board apply --from` writes **one receipt per issue**, never one per run, because “why is
P-AUT-241 Done” is a per-issue question a year later. It also pins partial application (3 of 26, with the
un-applied ones carrying their reason), the reverse-drift case (tracker said Done, branch had no evidence), and
three refusals: `StaleReport` (writes nothing, not even the unchanged issues), `NoEvidence`, and the idempotent
re-run.

### What these fixtures deliberately do not contain

- **No `phase`, `cursors`, `lease`, `desk`, `deps`, `autonomy`, `rules`, `pr` or `sow`.** Those stay in the
  kernel (`docs/seam.md` §3). A field that crosses by accident is how a worker starts believing it owns the
  workstream.
- **No ticket selection.** The kernel supplies the issue for the pass; a config that could pick one is a config
  that can work the wrong one (`TicketMismatch`).
