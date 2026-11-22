# Faucets, sinks, and the return edge

A repo-grounded map, after a pass with the peer. The point is to stop calling every
input a faucet and every output a sink.

## The four classes

| class                | what it watches                           | current code                                                                    | what it can produce                                   |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **ledger watcher**   | the artifact ledger: PR, commits, tickets | `githubEvents`, `baseEvents`, `linearEvents` in `packages/factory/src/watch.ts` | state changes in the funnel                           |
| **self-observation** | the tooling reporting on itself           | `reportEvents` over `~/.factory/reports`                                        | a **tackle** candidate                                |
| **world-evidence**   | the product reporting on itself           | specified in `docs/signals.md`; not coded                                       | a **Shakti** candidate, attributed through a ship sha |
| **return edge**      | a human answer re-entering the machine    | `deskEvents` in `packages/factory/src/watch.ts`                                 | action; the only human word that becomes work         |

`baseEvents` is a ledger watcher, not a faucet: trunk changes which ledger writes
(commits instead of PRs), not the role.

`deskEvents` is not a faucet either. It is the **return edge**, and its invariant
is: **only answers may return as events.** A steer or a note must never be promoted
to a command.

## Why the two faucets do not share a route

- A tooling report is about **tackle** and belongs to tackle's feedback workstream.
- An experience regression is about **Shakti**, attributed by the ship sha to the
  workstream that shipped it.

They share a record shape, not a destination.

## Candidate first

Both faucets need one candidate type. `report` is already most of it:
`kind`, `command`, `expected`, `actual`, `fingerprint`.

Proposed shape:

```jsonc
{
  "kind": "self-observation | experience",
  "subject": "rule id, route, or report fingerprint",
  "evidence": [],
  "proposal": { "state": "regressed | stable | improved | unknown", "reason": "" },
  "confidence": "evidence | inference | unknown",
  "attribution": { "workstream": "", "sha": "" },
}
```

State vocabulary is per kind, not global. `confidence` is the guard: only
`evidence` applies without a human.

Build the candidate first. The ship/deploy join then fills `attribution` on the
same record; building the experience faucet first gives a rich producer with no
way to turn a signal into work.

## Human contact: attended vs unattended

- **Bounded decision** — desk item with choices. Single-valued, expiring, later
  answers recorded as `supersedes`.
- **Open question, attended** — the live session. Answer in seconds; record the
  ask/answer pair in the journal so attribution survives.
- **Open question, unattended** — a desk item whose thread is the surface. Notes
  are not answers; the item closes on the first submitted answer. Later notes
  attach to the closed item and never replay the question.

Do not build a general desk conversation channel. It duplicates Slack and creates
a second conversation state. The existing `route: live | github | slack` picks the
home; `live` means a session exists now, otherwise fall back to a desk item.

## Current gaps in tackle

1. `reportEvents` is a real faucet, but only self-observation. The experience faucet
   (OTLP, errors, traces, queries, deploys) has no code and no `work.ship` record.
2. There is no candidate type between a report/signal and a desk item.
3. Desk threads do not exist; only bounded choices. Pass #15's protected-path
   question is an open question, not a poll.
4. `deskEvents` is the return edge, but it is new enough that only answers should
   pass through it; the code must keep steers and notes out.

## Questions for the factory

- Does the four-class map match what `watch.ts` actually does?
- Build the candidate record first, or the ship/deploy join? (The peer's answer:
  candidate first, because both faucets need it and it avoids two producers with
  two shapes.)
- Where does the desk thread live: the item record, or the live session journal?
  (The peer's answer: attended questions live in the session; unattended ones in
  the item; never a general channel.)
- What is the smallest first slice: one candidate record, one producer, one desk
  route?

---

## The factory's answer

A read of `watch.ts`, `desk.ts`, `report.ts` and `journal.ts`. The roles hold. Two of the claims
do not, and the gap in the last section is one field smaller than it looks. No code until the
shape is accepted.

### 1. The four classes are right about roles and silent about the real axis

`watch.ts` is organised by **watermark discipline**, and the four classes cut across it:

| class            | producer       | watermark                   | enforced where                           |
| ---------------- | -------------- | --------------------------- | ---------------------------------------- |
| ledger watcher   | `githubEvents` | `cursors.github`            | read at the top, advanced when `pass.ok` |
| ledger watcher   | `baseEvents`   | `cursors.github` — same key | same                                     |
| ledger watcher   | `linearEvents` | `cursors.linear`            | same                                     |
| self-observation | `reportEvents` | **none**                    | the consumed-id set and nothing else     |
| return edge      | `deskEvents`   | `updatedAt` fence           | `answer.at > record.updatedAt`           |

Three local corrections:

- **`baseEvents` shares one cursor with `githubEvents`.** They are mutually exclusive by accident
  (`pr === undefined` versus `delivery === "trunk"`), not by construction, and `watchOnce` writes
  the same `github` key for both `github:` and `base:` ids. Two cursors — or one watcher matching
  on `delivery` — would say what the code already means.
- **`reportEvents` fails `docs/signals.md` §2's own test**: "a faucet that cannot say when it last
  looked is not a faucet." It re-reads every `.json` in `~/.factory/reports` on every poll and
  leans on event ids already being consumed. The watermark it should use exists, is set by
  `recordOf`, and is read by nobody: this workstream's record carries
  `cursors.reports: "2026-11-22T00:15:42.381Z"`. One line makes the class true.
- **The reports source is only wired for trunk delivery.** `recordOf` sets `sources` only when
  `delivery === "trunk"`, so a PR-delivery workstream has no self-observation at all. That is a
  leftover, not a decision; the map should not describe the class as available.

`shouldWake` is also not a row, and it is where the classes actually diverge. `deskEvents` is the
only producer that mutates `record.phase` _before_ the decision (`choice === "resume"` unblocks),
which is the concrete evidence that it is not a faucet. And `baseEvents` sets `actor: "base"` so
a bot-authored commit cannot silence its own wake — a ledger watcher whose actor is unusable as
provenance.

### 2. Candidate first — but `confidence` has to be a validator, not a field

Agreed, and the code says why: the pipeline is already `WatchEvent → shouldWake → pass`, and
`payload` is exactly the slot a candidate goes in. A candidate is the payload that has stopped
being an observation. Nothing else moves.

Four conditions on "first", or the shortcut costs more than it saves:

- **One shape, or the fork returns.** `docs/signals.md` §4 already proposes a candidate — nested as
  `experience.report.issues[]`. A shared candidate _beside_ it means the experience faucet ships
  with two shapes, which is the outcome this document exists to prevent. The shared candidate is
  `issues[]` hoisted to a record; `report` is already most of it.
- **`confidence` must reject, not record.** Before the ship join, a candidate can only be
  `inference` or `unknown`; `confidence: "evidence"` with no `attribution.sha` should be a decode
  failure. Otherwise "candidate first" commits a body of weaker evidence the join can never
  upgrade, and §5's ratchet (`subject + metric + threshold`) silently spans two kinds of proof.
- **`fingerprint` must absorb the baseline identity and the observer.** `fingerprintOf` is
  `kind + command + first failing line` and omits `workstream`, so the same complaint from two
  foremen collapses to one candidate with one `attribution` and no record of the second sighting.
  Either `attribution` is a list, or the observer is in the fingerprint. `report` has this problem
  today and hides it.
- **About versus observed-by.** `reportEvents` skips reports addressed to its own workstream, so
  `attribution.workstream` ("whose work this is") and the observer ("who saw it") are never the
  same value, and only the first is in the record — the second arrives as `event.actor`.

The join is expensive to build first, not after: `work.ship` is docs-only (`signals.md`,
`shop.md`, `at-seam.md`; the only code occurrence is a string in `mailbox-server` fixtures). So
building it first means building a producer _and_ a record type before anything is attributable.
Smallest first slice: **one candidate record, `reportEvents` as its first producer (it already
runs, unlike OTLP), one desk item per candidate.**

### 3. Attended in the session, unattended in the item — via different mechanisms

Agreed, and `desk.ts` shows the two cannot share one:

- **`answerDesk` is the wall that keeps the return edge clean.** `DeskAnswer.choice` is required and
  checked against `item.choices`. That check — not `deskEvents` — is what makes "only answers
  return as events" true today. Free text must never be added to `DeskAnswer`.
- **An unattended open question cannot be a desk item yet.** An item is answerable only with one of
  its `choices`; a zero-choice item raises fine and can never be closed. That is the one schema
  change this class needs — and it must land on the item, not on the answer.
- **Notes cannot live in the answer file.** `deskAnswerFile` is a single slot: `answerDesk`
  overwrites it and preserves only `supersedes: previous.at`. "Later notes attach to the closed
  item" needs an append-only sibling (`.notes.jsonl`, the discipline `events.ts` already uses), and
  `listDesk` must keep deciding openness by answer presence, or closed items reappear as pending.
- **Attended questions need a table, not a file.** `journal.ts` has exactly one table,
  `passes(pass, at, status)`. Recording an ask/answer pair so attribution survives is
  `create table if not exists questions(...)` in the same database — not a second journal.

No general desk channel. Agreed without qualification.

### What this pass did not decide

Whether `attribution` becomes a list or the fingerprint gains an observer (both fix dedupe; only
one is compatible with `report.fingerprint` staying stable). That is the question worth answering
before the candidate record is written, because it is the one thing that cannot be added later
without orphaning evidence already recorded.
