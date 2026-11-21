# The loop, and the three places a human meets it

One project, one dependency tree, one PR, one set of reviewers, and a factory that keeps working the gap. This
document is the spine the others hang on: `docs/signals.md` (where the evidence comes from), `docs/slack.md` (the
strategic surface), `docs/surfaces.md` (the surface contract), `docs/workstream.md` (the object).

---

## 1. The loop

```
  author                     kick off                    work                       review
  ──────                     ────────                    ────                       ──────
  human + agent    ──▶  factory adopt  ──▶  passes: build · land  ──▶  ONE PR  ──▶  humans
  in a live session      (project +        (checks are the gate)                 (GitHub)
  (herdr / rex)           dep tree)                                                  │
                               ▲                                                    ▼
                               │                                          review comments,
                     experience evidence                                 change requests
                     (faucets: deploys,
                      traces, slow queries)  ◀── attributed to the ship ──┘
```

The left end is _authoring_: a human and an agent sitting together in a live terminal, writing the project
description and the dependency tree. That is not factory work — it is the work the factory is pointed at.

The right end is _judgement_: a PR, reviewers, comments, and a merge that only a person performs.

Everything between is a pass, and every pass ends in a checkpoint or a desk item.

## 2. Four ledgers, one rule each

| ledger                    | what it is the truth about                                          | who writes it                                                      |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **GitHub**                | the artifact: PR, commits, checks, review threads, merge            | humans review; passes push; only a person merges                   |
| **Linear**                | intent: the project, its tickets, their states                      | a human authors; the factory only _proposes_ (`docs/reconcile.md`) |
| **the workstream record** | the factory's own position: phase, cursors, lease, checkpoint, desk | the kernel                                                         |
| **the journal**           | the conversation: what was said and what happened                   | the worker, committed before it is shown                           |

**No mirroring.** Not one of these is copied into another. A digest is a rendering, a desk item is a question, and
neither is a second copy of the ledger. The moment GitHub's state is mirrored into Linear, one of them is stale and
nobody knows which.

---

## 3. Three surfaces, three roles

|                | **machinery**                                               | **funnel**                               | **strategy**                                            |
| -------------- | ----------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| where          | herdr · rex · a terminal                                    | GitHub · Linear                          | Slack (or any team chat)                                |
| latency        | seconds                                                     | hours                                    | days                                                    |
| the human is   | _inside_ the loop, watching it work                         | at the _boundary_ of the work            | _outside_, thinking about direction                     |
| what goes in   | a thought: “try the refusal path first”, “no, that's wrong” | a review comment, a ticket edit, a merge | a product question, a priority, “why are we doing this” |
| what comes out | a live question that can be answered _now_                  | a revision pass, a mergeable PR          | a projection: what the factory intends and needs        |
| answer type    | **steer** — additive, unfenced                              | **state** — GitHub is the ledger         | **decision** — a desk item                              |

### Why the answer types differ, and must

- **A steer is additive.** Being wrong is cheap, there can be three at once, and the session holds the pen: the
  fence is the lease, not the comment. So steers are never fenced, never superseded, never recorded as answers.
- **A state change is singular.** A PR is merged or it is not. GitHub already enforces one-writer-per-action with
  its own permission model; we do not add a second one.
- **A decision is single-valued.** It has options, it expires, and the first valid answer wins with later ones
  recorded as `supersedes` — because “should we split this PR” has exactly one answer at a time.

The practical rule that falls out: **prose in a live surface is a steer, prose in a strategic surface is a note,
and only a button is an answer.** A human who types “ok, merge it” into a thread is giving the factory context;
if it is decision-shaped, the bot turns it into an item — once, quietly, with the sentence quoted.

---

## 4. Routing: a decision goes where that kind of decision is already made

| the question                                        | where it is asked     | why                                                                        |
| --------------------------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| “which refusal code should this return?”            | GitHub, on the PR     | it is a code decision and the diff is already there                        |
| “is the scope of this ticket right?”                | Linear, on the issue  | it is an intent decision and the ticket is the intent                      |
| “should we split PR 1862?”                          | Slack, to the channel | it is a product decision and the channel is where the product is discussed |
| “the dev server won't start, should I recreate it?” | herdr, live           | it is a ten-second decision and the session is already open                |

The human should never have to _go somewhere_ to answer. That is the only real justification for four surfaces —
and the reason a workstream needs a `route: slack | github | live` on each desk item, declared when it is raised.

Corollary: a routed item has **one home**. Cross-posting the same question to Slack and GitHub is two records and
two answers, and the second is always wrong.

---

## 5. Where the faucets sit

Two loops, joined by a sha.

```
  delivery loop   author → adopt → passes → PR → review → merge
  experience loop service → traces/logs/queries → candidates → a ticket in the funnel
                        ▲                                    │
                        └──────────── work.ship.sha ──────────┘
```

Every shipped sha is a deploy marker; every regression measured after it is attributed to the workstream that
shipped it. So the experience loop does not need a dashboard or a human reading graphs — it proposes a ticket in
the same funnel the factory already works, with the deploy, the PR and the receipt as its evidence
(`docs/signals.md`).

Three rules keep it from becoming a firehose:

1. a signal becomes a **desk item**, never a ticket directly;
2. `maxProposalsPerCycle` and an `experience.baseline` ratchet, so a known-slow route stops asking;
3. a signal never blocks a phase — a slow route does not stop a correctness fix.

## 6. The strategy surface is bidirectional

Slack is not only where the factory asks; it is where the product is discussed, and that conversation is an input
the other surfaces do not have.

- **out:** a product question, or a projection (“perms-1862: 26 reconciled, 16 left, one PR, needs review by Friday”).
- **in:** the conversation itself. Declared channels may be _read_ as context — and only declared ones, where the bot
  is a member, in a workspace that opted in. What it learns is a **hint**: it can shape a proposal, never answer a
  desk item, never edit the SOW.

That asymmetry is the whole governance story: listening produces candidates; only a person produces decisions.

## 7. What must never happen

- the journal or the room transcript appearing in Slack (“here's what the agent is thinking”);
- a bot answering its own comment, or waking on its own steer — the loop that eats a channel;
- prose accepted as an answer to a decision;
- one item cross-posted to two surfaces;
- autonomy widening because more people can watch (`docs/slack.md` §5);
- a digest that reads like activity (“3 passes run!”) instead of state (“checkpoint 12m ago”).

## 8. Open

- **Steer attribution.** Steers are additive by design, but “who asked for this?” has no record unless the pass
  quotes it. The prompt file could carry the steer text and the actor; that is cheap, and it makes a later review
  able to say why a change exists.
- **Listening consent.** Reading a team channel as context needs a visible answer to “what does the bot remember?”
  — probably: nothing but the hints it wrote into the workstream record, each one citing the message.
- **Multi-repo projects.** One project, two repos, two factories? The funnel says one PR; the dep tree may not.
