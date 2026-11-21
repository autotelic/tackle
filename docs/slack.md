# The strategic surface (Slack, and the role behind it)

Of the three places a human meets the factory (`docs/factory-loop.md` §3), this is the noisy one: days, not
hours; outside the loop, not inside it; intent, not state. Slack is one implementation. The role is what the
design serves, so a Discord, a Teams, or a web space can fill it without changing a single rule below.

---

## 1. What this surface is for

Two jobs, and neither is “status”.

1. **Ask.** A product question the factory cannot answer from the repo: “is this project's scope still what we
   want by Friday?”, “the reconciliation says 26 done — do you believe it?”. These are _decisions_: they arrive as
   desk items, they have options, they expire, and a button answers them.
2. **Listen.** The product is _discussed_ here, and that conversation is an input nothing else has. Declared
   channels may be read as context; what comes out of them is a **hint**, never an answer, never a SOW edit.

The asymmetry is the governance story: **listening produces candidates; only a person produces decisions.**

## 2. What this surface is not

- not a status board — status is `factory status`, one line, and a digest at most hourly;
- not a conversation with the agent — that is the machinery surface, where the session is live and a thought is
  free;
- not where code decisions live — those belong on the PR, where the diff is;
- not the ledger. If the Slack app is uninstalled, we lose a doorbell and nothing else.

## 3. The three shapes it renders

| shape          | cadence                                         | contains                                                                                         | never contains                                      |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| **projection** | ≤1 per area per hour, only if something changed | one line per workstream: phase · checkpoint age · freshness · open items · what it is waiting on | “3 passes run!”, a tool call, a token stream        |
| **item**       | one message per item, edited as it changes      | title, why, the artifact rows (diffstat, jig counts, check state), buttons                       | a decision the bot made for you                     |
| **thread**     | on demand                                       | the discussion around an item, and steers that a human chose to give here                        | the journal, the room, “what the agent is thinking” |

A projection that reads like activity is a bug: **state, not motion.**

## 4. The channel shape

| question                               | answer                                 | why                                                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| channel per project or per workstream? | **per area**, thread per workstream    | a workstream lives weeks; forty channels is a sidebar nobody reads, and per-channel notification prefs are the actual product                                                                             |
| one bot or a bot per foreman?          | **one bot**, persona per message       | a bot is a Slack _app_: one OAuth install, one token rotation, one name registration. Persona is `username` + `icon_emoji` (`chat:write.customize`), so “I'm the perms-1862 foreman” survives a reinstall |
| DMs?                                   | one, for “anything needs me”           | a DM per workstream is channel sprawl in a worse place                                                                                                                                                    |
| who speaks?                            | the bot, as the **workstream's label** | the label is a display string, never an authority                                                                                                                                                         |

```
#shakti-forestbuilder          ← area: projections, items, thread roots
  └─ 🧵 perms-1862             ← one thread per workstream; persona = the workstream
       ├─ item: merge 2 PRs     ← buttons: the only thing that blocks
       └─ human reply          → a steer or a note, never an answer
```

---

## 5. Inbound: what a human action means here

| what they do                     | what it becomes                  | why                                                     |
| -------------------------------- | -------------------------------- | ------------------------------------------------------- |
| click an **item button**         | `desk.answer` record             | a choice is an axis with options; an answer is evidence |
| reply **in the item's thread**   | a **note** on the item           | free text is ambiguous; the button is the decision      |
| write in a **declared channel**  | a **hint** for the next proposal | context, not authority                                  |
| `@factory …` toward a workstream | a **steer**                      | the same as typing it into the live session             |
| react 👀                         | nothing                          | a reaction is not an answer                             |

And the rule that follows from the routing table (`docs/factory-loop.md` §4): **this surface is for product
decisions.** A question about a refusal code goes on the PR; a question about a ticket's scope goes on the ticket.
An item has exactly one home.

## 6. Identity

- **The bot is the org's DID** — a transport identity that signs nothing.
- **A Slack user is not a DID.** The binding is an explicit `link` record: `{ surface, subject: "T0123/U0456", did,
  role, at }`. Display names are claims; the subject is stable.
- **Bot token, never user token.** Acting as a human is right for a personal assistant and wrong for a project
  foreman: a workstream that speaks in a person's voice has no visible boundary between the bot's opinion and that
  person's.
- **Hints cite their source.** A hint carries the channel, the message id and the sentence it came from, or it does
  not exist.

## 7. What Amp got right, and where we differ

Amp's Spaces are the closest thing in the wild. Copy: a space is an initiative with a goal and the agent keeps its
threads directed at it; live cards with status and “needs someone”; and **comments are human-only until someone
mentions the agent**, so a team can talk without waking a bot.

Differ: their channel linking is all-or-nothing, public-channel-only, and bot posts never reach the space — right for
a planning surface, wrong for a workstream whose review comments arrive as bots. Our rule is per-event
(`packages/factory/test/fixtures/watch/wake-cases.json`: `self-authored` does not wake, `stale-head-review` does).

And take their sharpest rule, from the multiplayer docs: in a shared thread the agent **refuses to change account
settings, secrets or configuration**. Generalized: **the more humans can watch, the narrower the autonomy.** A
workstream whose thread is shared with three people may not rotate a credential or accept a baseline.

## 8. What not to build

- a bot, channel or DM per workstream;
- streaming output (rate limits, and it makes the message a transcript);
- the journal or the room mirrored in (`docs/factory-loop.md` §7);
- `@here` / `@channel` from a bot, ever;
- an approval prompt on every tool call — we ship one human gate and a projection, because two gates train
  click-through (`docs/executor.md`);
- a bot that comments on prose. If it must ask “record that as an answer?”, it asks **once**, quoting the sentence,
  and never again for the same item.

## 9. Threading into the build

- nothing in P0–P2 changes: a desk item is the interface (`packages/factory/test/fixtures/desk/`), and this surface
  is a renderer. The kernel gains one outbound hook and one inbound route.
- **one new field on the item:** `route: "slack" | "github" | "live"`, declared when it is raised, so an item has
  exactly one home.
- **the first thing to write is the renderer**, against a fixture: `item → blocks`, and a “READY TO REVIEW” message
  built from `factory status` plus the lander's item. Then the real app is a transport, not a design session.
