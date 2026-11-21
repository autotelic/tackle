# Slack: the sink humans actually look at

`docs/surfaces.md` says a surface owns nothing: it ingests, it answers, it renders. This document is the Slack
shape of that — what the factory says, where, as whom, and what it must refuse to say.

---

## 1. The decision, up front

| question                               | answer                                       | why                                                                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| channel per project or per workstream? | **per area**, thread per workstream          | a workstream lives weeks; channels are membership and notification surfaces, and forty channels is a sidebar nobody reads                                                                                     |
| one bot or a bot per foreman?          | **one bot per factory**, per-message persona | a bot is a Slack app: one OAuth install per workspace, one token rotation, one name-registration. Persona belongs in the message (`chat:write.customize` allows `username` + `icon_emoji`), not in an install |
| DM?                                    | **only for “anything needs me”**             | a DM per workstream is the channel sprawl problem in a worse place                                                                                                                                            |
| who speaks?                            | the bot, as the **workstream's label**       | “I'm the permissions foreman” is a property of the message, and it survives the app being reinstalled                                                                                                         |

So the shape is:

```
#shakti-forestbuilder        ← area channel: digests, items, thread roots
  └─ 🧵 perms-1862           ← one thread per workstream, the bot's persona = "perms-1862"
       ├─ item: merge 2 PRs   ← Block Kit, buttons, the only thing that blocks
       └─ human reply         → steer / note, never an answer
```

---

## 2. Three surfaces, three cadences

| surface    | cadence                                         | contains                                                                     | never contains                          |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------- |
| **digest** | ≤1 per area per hour, only if something changed | one line per workstream: phase · checkpoint age · freshness · open items     | a tool call, a token stream, “working…” |
| **item**   | one message per item, edited as it changes      | title, `why`, the artifact rows (diffstat, jig counts, check state), buttons | a decision the bot made for you         |
| **thread** | on demand                                       | conversation with the foreman: steer, ask, dispute                           | the room's transcript mirrored in       |

Rule of thumb: **if it does not need a human, it is a digest line, not a message.** The shop docs' claim that
attention is the binding constraint is only true if the factory spends it deliberately — a channel muted in a week
is worse than no channel.

## 3. Inbound: what a human action means

| what they do                                  | what it becomes                            | why                                                         |
| --------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| click an **item button**                      | `desk.answer` record                       | a choice is an axis with options, and an answer is evidence |
| reply **in the item's thread**                | a **note** on the item, not an answer      | free text is ambiguous; the button is the decision          |
| `@factory <id> …` in an area channel          | a **steer** to that workstream's next pass | the same as typing it in the terminal                       |
| react 👀                                      | nothing                                    | a reaction is not an answer                                 |
| reply in a workstream thread without a button | a note + a wake                            | conversation is allowed to be text; decisions are not       |

Two of these are the whole safety story: **buttons produce answers, prose produces notes**, and an answer is a
record that outlives the person who gave it.

---

## 4. Identity, and the one thing Slack cannot give us

- **The bot is the org's DID.** It signs nothing; it is a transport identity.
- **The per-message persona is the workstream label**, so `perms-1862` reads as the one responsible — but it is a
  display string, never an authority.
- **A Slack user is not a DID.** The binding is an explicit `link` record (`docs/surfaces.md` §4):
  `{ surface: "slack", subject: "T0123/U0456", did, role, at }`. Display names are claims; `T0123/U0456` is a
  subject.
- **Bot token, not user token.** Acting as a human (`@estebanforge/pi-slack-me`, a `xoxp-` token) is right for a
  personal assistant and wrong for a project foreman: a workstream that speaks in a person's voice has no visible
  boundary between the bot's opinion and that person's.

## 5. What Amp got right, and where we differ

Amp's Spaces are the closest thing in the wild and worth copying in three places:

1. **a space is an initiative with a goal**, and the agent keeps its threads directed at it — our workstream is that
   space, with a Linear project as the goal's home;
2. **live cards with status and “needs someone”** — our digest line and item are the same idea, and “needs someone”
   is the single most valuable bit;
3. **comments are human-only until someone mentions the agent** — a team can discuss without waking the bot. Worth
   copying literally.

Three places I would not copy:

- **channel-to-space linking is all-or-nothing and public-channel-only**, and “other messages, including bot posts,
  do not reach the space”. That is fine for a planning surface and wrong for a workstream: a foreman needs the
  _review comment_ to reach it, and its own posts to never wake it — which is a per-event rule (see
  `packages/factory/test/fixtures/watch/wake-cases.json`, `self-authored`), not a channel rule.
- **one identity for the whole surface.** For them, `@Amp` is enough because a space is one conversation. We have
  N workstreams in one channel and a human asking “which one is this?” — persona per message is cheap and fixes it.
- **multiplayer that widens access without narrowing autonomy.** Their security note is the sharpest thing in
  their docs: in a multiplayer thread the agent _refuses_ to change account settings, secrets or configuration.
  Copy that rule: **the more humans can watch a workstream, the narrower its autonomy.** A thread shared with three
  people must not be allowed to rotate a credential or accept a baseline.

## 6. The two entry points, and the message we owe the operator

Starting work should feel the same from either side:

```
terminal     factory up perms-1862            ← the door we already have
slack        @factory up perms-1862           ← same call, same refusals (BlockedByDependency etc.), rendered as a message
```

And the message the whole factory exists to send:

```
perms-1862 · READY TO REVIEW
  PR 1862 · 14 files +412 −88 · jig 0 error / 2 warn (baseline) · tests green
  checkpoint 2m ago · 3 passes · queued: 11 leaves
  [ Open thread ]  [ Approve merge ]  [ Reject with a note ]
```

Every number in it exists already — it is `factory status` plus the lander's item, rendered. That is the test of the
whole design: **the thing a human sees first is the artifact, not a claim about the artifact.**

## 7. What not to build

- a bot, channel or DM per workstream;
- streaming output into Slack (rate limits, and it makes the message a transcript);
- Slack as a source of truth — if the Slack app is uninstalled, nothing is lost except the doorbell;
- `@here`/`@channel` from a bot. Ever;
- an approval prompt on every tool call. We ship one human gate (the desk) and a digest; two gates train
  click-through (`docs/executor.md`).

## 8. Threading into the factory as built

- **P1/P2 need no change.** The desk item shape is the interface (`packages/factory/test/fixtures/desk/`), and
  Slack is a renderer: buttons → `desk.answer`, replies → notes. The kernel gains one outbound hook
  (`notify`) and one inbound route, not a second state machine.
- **What to build after P2:** a renderer that turns an item into Block Kit, a digest tick, and the `link` table.
  All three are testable against fixtures with no Slack workspace: the button payload is just JSON.
- **The ordering that saves rework:** write the `item → blocks` renderer and a "ready to review" fixture _before_
  the Slack app exists. Then the first real app is a transport, not a design session.
