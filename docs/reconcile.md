# The reconcile report

A read-only record of what the branch says against what the tracker says, plus the contract for applying it.
Born from one project: Permissions has 42 issues at Backlog while the branch and its document claim 26 leaves
done or refused. That gap is why `reconcile` is the first phase.

---

## 1. Why a report and not a rewrite

The cost of a wrong autonomous state change is not the state change — it is the human's trust in the place
that holds their intent. So the worker **proposes**, the human applies, and the proposal carries its evidence.
A reconciliation that exists only as a comment answers “why was this marked done” for as long as the comment
survives; as a record it has an id and can be cited by the receipt that applied it.

---

## 2. The record

One record per run. `kind: derived` (a tool regenerates it) — the same registry rule as `report` and
`catalog`: once published, fields may be added optionally and never reinterpreted.

```jsonc
{
  "lexicon": { "name": "reconciliation", "version": 1 },
  "at": "2026-11-21T22:40:00Z",
  "workstream": "perms-1862",
  "readOnly": true,
  "observed": {
    // the watermarks the report was built from
    "linear": "2026-11-21T22:39:41Z",
    "github": "2026-11-21T22:39:12Z",
    "prHead": "55aa5293a",
  },
  "summary": {
    "issues": 42,
    "done": 26,
    "refused": 3,
    "remaining": 11,
    "unknown": 2,
    "blocked": 0,
  },
  "issues": [/* entries, §3 */],
}
```

**`observed` is what makes the report honest.** A snapshot without watermarks is a claim about the world
with no date. With them, `board apply` can refuse a report whose world has already moved — the same rule as
`observedThrough` for presence, and the same reason a quiet number needs its denominator.

---

## 3. An issue entry

```jsonc
{
  "issue": "P-AUT-241",
  "title": "Scope read policies to project membership",
  "linearState": "Backlog",
  "evidence": {
    "commits": ["55aa5293a", "b1c9d02e4"],
    "files": ["src/permissions/policy.ts", "src/permissions/policy.test.ts"],
    "pr": { "number": 1862, "state": "open", "checks": "passing" },
    "checks": ["unit:policy.test.ts"],
  },
  "proposal": {
    "state": "done",
    "reason": "2 commits and a passing test name the policy scope rule",
  },
  "confidence": "evidence",
  "blockers": [],
}
```

**Four proposal states, not two.**

| state       | meaning                                              | applies without a human?         |
| ----------- | ---------------------------------------------------- | -------------------------------- |
| `done`      | a commit, PR or passing check names the issue's work | yes, with `confidence: evidence` |
| `refused`   | an explicit decision in the tree or the project doc  | no                               |
| `remaining` | the project has work left and no evidence exists     | no (nothing to apply)            |
| `unknown`   | no evidence either way, or sources disagree          | never                            |

`unknown` is the one that keeps the report from lying. Collapsing it into `remaining` turns “nobody looked”
and “there is nothing there” into one number — the exact confusion the five adoption states exist to avoid.

**`confidence` is the second axis.** `evidence` means a commit, PR or check _names_ the issue (the issue key in
a commit message, a linked PR, a test file path). `inference` means branch or title correlation. Only
`evidence` may be applied without a human, and the report prints both counts.

---

## 4. `board apply --from <report>`

The command that turns a proposal into a state. It is the only thing that writes to Linear, and it writes only
what a human approved.

```sh
board apply --from .factory/reports/perms-1862-2026-11-21T22-40Z.json \
            [--only P-AUT-241 --only P-AUT-247] \
            [--confidence evidence|all] \
            [--dry-run]
```

| refusal       | condition                                                        | why                                                              |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `StaleReport` | current cursors are newer than the report's `observed`           | applying a stale snapshot overwrites truth someone learned later |
| `NoEvidence`  | a `done` proposal has no commit, PR or check                     | the state would be an assertion, not a record                    |
| `Ambiguous`   | two issues claim one commit with different proposals             | the report is wrong and a human must look                        |
| `SowEdit`     | anything touches the project description, SOW or another project | those are authored intent                                        |
| `Unknown`     | `--only` names an `unknown` issue                                | nothing to apply; report it instead                              |

And what it always does:

- **one receipt per applied issue**, naming the report id and `at` — so “why is this done” is answerable forever;
- **`--dry-run` prints the exact calls** it would make (issue, from, to, reason);
- **never touches `unknown`**, even with `--confidence all`;
- **idempotence**: re-applying the same report is a no-op because the receipt already names the issue;
- **partial is normal**: a human may apply three of twenty-six, and the report says so on the next run
  (the un-applied ones come back as `remaining`, with the earlier proposal quoted).

---

## 5. Fixture shape (Permissions, abridged to six of forty-two)

```jsonc
{
  "lexicon": { "name": "reconciliation", "version": 1 },
  "at": "2026-11-21T22:40:00Z",
  "workstream": "perms-1862",
  "readOnly": true,
  "observed": {
    "linear": "2026-11-21T22:39:41Z",
    "github": "2026-11-21T22:39:12Z",
    "prHead": "55aa5293a",
  },
  "summary": {
    "issues": 42,
    "done": 26,
    "refused": 3,
    "remaining": 11,
    "unknown": 2,
    "blocked": 0,
  },
  "issues": [
    {
      "issue": "P-AUT-241",
      "linearState": "Backlog",
      "evidence": { "commits": ["55aa5293a"], "pr": { "number": 1862, "checks": "passing" } },
      "proposal": { "state": "done", "reason": "commit names the issue key" },
      "confidence": "evidence",
    },

    {
      "issue": "P-AUT-242",
      "linearState": "Backlog",
      "evidence": { "files": ["docs/permissions/refusals.md"] },
      "proposal": { "state": "refused", "reason": "project doc records the refusal decision" },
      "confidence": "evidence",
    },

    {
      "issue": "P-AUT-243",
      "linearState": "Backlog",
      "evidence": {},
      "proposal": { "state": "remaining", "reason": "no commit, PR or check mentions it" },
      "confidence": "evidence",
    },

    {
      "issue": "P-AUT-244",
      "linearState": "In Progress",
      "evidence": { "files": ["src/permissions/membership.ts"] },
      "proposal": { "state": "done", "reason": "file and title correlate" },
      "confidence": "inference",
    },

    {
      "issue": "P-AUT-245",
      "linearState": "Backlog",
      "evidence": {},
      "proposal": {
        "state": "unknown",
        "reason": "branch and tracker disagree; nothing inspected",
      },
      "confidence": "evidence",
    },

    {
      "issue": "P-AUT-246",
      "linearState": "Done",
      "evidence": {},
      "proposal": { "state": "unknown", "reason": "tracker says done, branch has no evidence" },
      "confidence": "evidence",
    },
  ],
}
```

The six cover all four proposal states, both confidence values, and the reverse drift (tracker says done,
branch says nothing) — which is the case a report must not silently flatten.

---

## 6. Acceptance

- A stranger reads the report and can say what happened on the branch **without opening it**.
- Every `done` has a commit, PR or check named in `evidence`; every `unknown` says _why_ it is unknown.
- Applying a stale report is refused by name, not by silence.
- Nothing in the report modifies Linear, and `apply --dry-run` makes no calls.
- The summary's five counts sum to `issues`; a report where they don't is invalid.

---

## 7. Open

- **Per-issue records vs one report.** One record with an array today; per-issue at-uris would let a commit cite
  a proposal directly, at the cost of 42 records per run. Vote: one report, and the _apply receipts_ are
  per-issue.
- **Where reports live.** `.factory/reports/` outside the repo (consistent with the workstream record) versus a
  blob by CID. Vote: outside the repo now, a CID when there is a blob store.
- **Whether `refused` needs its own source.** Today it reads the project doc; a Linear “won't do” state would be
  better evidence, and that is a tracker question, not ours.
