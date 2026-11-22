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
