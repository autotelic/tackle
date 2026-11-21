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

### What these fixtures deliberately do not contain

- **No `phase`, `cursors`, `lease`, `desk`, `deps`, `autonomy`, `rules`, `pr` or `sow`.** Those stay in the
  kernel (`docs/seam.md` §3). A field that crosses by accident is how a worker starts believing it owns the
  workstream.
- **No ticket selection.** The kernel supplies the issue for the pass; a config that could pick one is a config
  that can work the wrong one (`TicketMismatch`).
