# Surfaces

Slack, GitHub, a terminal, a phone. Each one is another way several people and several agents
stand in the same room — and the only thing that makes that safe is that **a surface is a
projection of the desk, never a second copy of it.**

This document is the deep dive: what opencode actually ships, what the three real Slack bridges do,
how Slack's platform mechanics land exactly on our idempotency and fence rules, and the three verbs a
surface is allowed to have.

It sits inside a larger frame: **three surfaces, three roles** — the _machinery_ you are inside
(herdr/rex/terminal: steer, live), the _funnel_ at the boundary of the work (GitHub/Linear: state),
and the _strategy_ outside the loop (Slack: intent). The roles, the ledgers, and where each decision
is asked live in `docs/factory-loop.md`; Slack's role specifically is `docs/slack.md`.

The distinction that matters for everything below: **a steer is additive and unfenced** (the lease
holds the pen), **a state change is GitHub's** (it already has a permission model), and **a decision
is single-valued** (a desk item, first valid answer wins, later answers recorded with `supersedes`).

---

## 0. The invariant

```
   GitHub ─────┐
   Slack  ─────┤                        ┌──────────────────────────────────────┐
   terminal ───┼── ingest ──▶ desk.item │  the desk is the only conversation   │
   phone  ─────┤                        │  state; every surface is a view of it │
   agent  ─────┘◀── render ──────────── │                                      │
                ◀── answer ── desk.answer└──────────────────────────────────────┘
```

A surface may do exactly three things:

| verb       | what it means                                                             | what it may not do                      |
| ---------- | ------------------------------------------------------------------------- | --------------------------------------- |
| **ingest** | turn a thing that happened on that surface into a `desk.item` (or `mail`) | invent its own queue                    |
| **answer** | turn a human's response into a `desk.answer` **record**                   | keep the answer in its own thread state |
| **render** | show the current state, read-only, in that surface's idiom                | own any state a restart would lose      |

If a surface owns state, it becomes a second source of truth, and the second one always wins by
being the one the human looked at last.

---

## 1. What opencode actually ships, and what its Slack bot got wrong

I was wrong in the first draft of this document: **opencode did ship a Slack bot.** It is
`packages/slack` — `@opencode-ai/slack`, 120 lines, `@slack/bolt` + `@opencode-ai/sdk`, Socket Mode —
added 2025-10-14 ("feat: add Slack integration package with Bolt framework"), extended by
#3163 ("use realtime events for live tool call updates in Slack"), and **absent from the V2 tree**
today. What ships now is a server, an SDK, and ACP; the community filled the gap with three mature
bridges. All three facts matter, and the source of the deleted one is the best teaching artifact in
the set.

### 1.1 The original, read line by line

```ts
const app = new App({ token, signingSecret, socketMode: true, appToken })
const opencode = await createOpencode({ port: 0 }) // an in-process server, port 0
const sessions = new Map<string, { client, server, sessionId, channel, thread }>()

app.message(async ({ message, say }) => {
  const thread = message.thread_ts ?? message.ts
  const key = `${message.channel}-${thread}`
  let session = sessions.get(key)
  if (!session) {
    const created = await client.session.create({ body: { title: `Slack thread ${thread}` } })
    const shared = await client.session.share({ path: { id: created.data.id } })
    await app.client.chat.postMessage({ channel, thread_ts: thread, text: shared.data.share.url })
    sessions.set(key, (session = { … }))
  }
  const result = await session.client.session.prompt({ path: { id: session.sessionId }, body: … })
  await say({ text: responseText, thread_ts: thread })
})
```

Plus: an event subscription that posts `*tool* - title` into the thread when a tool completes, and a
`/test` slash command. Seven decisions in 120 lines, four of them right:

| decision                                    | verdict                             | why                                                                                                                       |
| ------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Socket Mode, no public URL                  | **right**                           | outbound-only, no tunnel, no inbound port — the same rule our shop follows                                                |
| thread = session, keyed by `channel-thread` | **right**                           | the universal mapping; every mature bridge does it                                                                        |
| **share the session and post the URL**      | **right, and underrated**           | a thread gets a _link a second human can open_ — multiplayer wasn't an afterthought, it was the third line of the feature |
| tool completion → one message per tool      | _spam_                              | ten tools is ten messages; the mature bridges edit one status message or offer `off/events/status/trace`                  |
| `const sessions = new Map(…)`               | **wrong, and fatal**                | a restart orphans every thread. The community plugin persists `slack-sessions.json`; we persist a record                  |
| `await prompt(...)` then post once          | **wrong for a surface**             | the handler holds the event open for the whole run; no streaming, no queue depth, no ack semantics                        |
| no permission forwarding                    | **wrong, and the one that matters** | an OpenCode permission prompt has nowhere to go, so the agent blocks and the thread looks broken                          |
| `console.log(JSON.stringify(context))`      | don't                               | every event, including message bodies, into the log                                                                       |

It was a prototype — probably a Sunday's worth — and it is honest about what a prototype optimises for.
Every one of the four failures is a _durability_ failure, which is the whole thesis: a surface that
keeps state in its own process is a surface that loses the conversation.

### 1.2 Why it is not in V2, and what replaced it

V2 has `opencode acp` — the Agent Client Protocol, JSON-RPC over stdio, no port — and an SDK that
lets you host the server in-process. That is a **better surface seam than a Slack package**, because
the surface author supplies the transport, the identity, and the durability:

```json
{
  "sessionCapabilities": { "close": {}, "delete": {}, "fork": {}, "list": {}, "resume": {} },
  "promptCapabilities": { "embeddedContext": true, "image": true }
}
```

and it reads one client capability that matters here: `elicitation.form` — _the client can ask the
user a question as a form_. A permission prompt and a clarifying question are protocol messages, not
chat messages.

**That is our desk, viewed from the other end.** ACP's permission request ↔ `desk.item`; the user's
answer ↔ `desk.answer`; `resume`/`fork`/`list` ↔ the journal and the vise. ACP assumes the client is
alive for the duration; the desk does not. So the layering is:

```
  Slack ──▶ ACP (session, permission, question) ──▶ the bench's room
              │
              └──▶ desk.item / desk.answer   (durable, addressable, survives the client)
```

That split is the reason to use ACP rather than a bespoke RPC: the session half and the durable half
are already separated by a protocol, and a surface only has to implement the first.

### 1.3 The three community bridges, compared

| project                             | transport                                                                  | session mapping                                                | what it forwards                                                                                                                                | identity                              |
| ----------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **leecoder/opencode-slack-agent**   | Socket Mode (`xapp-`, `connections:write`)                                 | thread = session, persisted to `slack-sessions.json`           | **permission prompts** (`1/2/3` = allow/always/reject), **questions with options**, tool status, reasoning, todos; long replies as file uploads | `ALLOWED_USERS`, per-message `@agent` |
| **kortix-ai/opencode-channels**     | public HTTPS webhook (needs a tunnel) via the Vercel Chat SDK              | thread → session                                               | **streams by editing a placeholder every 600ms** (⏳ → ✅), slash commands, reaction = retry, files                                             | signing secret + bot token            |
| **ominiverdi/opencode-chat-bridge** | Socket Mode for Slack; Matrix/WhatsApp/Discord/Telegram/Mattermost besides | **per-thread isolated ACP session**, persisted across restarts | tool presentation modes (`off/events/status/trace`), progressive argument updates, pagination, **edit-failure recovery**                        | `allowedUsers` per connector          |

Four conclusions, three of which are corrections to the prototype:

1. **Thread = session is the universal mapping**, and all three persist it. Ours is stronger: the map
   is a _record_ (`slack` thread → `work.scope`), so it survives the bridge, not just its process.
2. **Permission forwarding is the feature, not streaming.** The bridge people trust is the one that
   surfaces _"may I run this?"_ in the thread. A swallowed prompt is a hung agent.
3. **Streaming is a rendering decision, not a protocol one.** One message edited at milestones
   (or on a 600ms timer) beats ten appended messages — and it puts the rate limit in one place.
4. **Socket Mode beats a public URL.** Two of three chose outbound-only, which is the same rule our
   shop already follows: **nothing dials in.** The third needs `ngrok`, which is a tell.

---

## 2. Slack's mechanics, and why they fit

The pleasant surprise: Slack's delivery model is the same shape as GitHub's, and both are the same
shape as our mailbox.

| Slack                                                                                                                                    | our equivalent                                                   | consequence                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| deliver an event; **retry** it if not handled, tagged with `X-Slack-Retry-Num` / `-Reason`                                               | `(senderDid, TID)` idempotency; `accepted → delivered → acked`   | **the retry header is the idempotency key** — a retried delivery is a replay, not a second item |
| Events API events are **auto-acknowledged**, but interactive payloads (buttons, commands, modals) must be `ack()`ed **within 3 seconds** | the 200 must mean _admitted_, not _done_                         | the handler writes to the journal and returns; work happens after                               |
| `X-Slack-Signature` (v0 HMAC-SHA256) + `X-Slack-Request-Timestamp` with a ~5 minute window                                               | the signature is the _transport's_ auth, not the user's identity | verify, then translate; never pass Slack identity into the bench                                |
| **Socket Mode**: outbound WSS, app-level token, no public URL, no request signing                                                        | outbound-only shop                                               | the default; Public URL only if a workspace cannot install a socket app                         |
| `thread_ts`                                                                                                                              | the desk item's `refs`                                           | a thread is a conversation _about_ an item, not the item                                        |
| Block Kit `block_actions` with a payload per button                                                                                      | `desk.item.choices[]` → `desk.answer.values`                     | a choice is a record field, not a UI invention                                                  |
| `chat.update`                                                                                                                            | re-render, not append                                            | rate-limited (≈1/sec per channel is the safe working number); update on milestones, not tokens  |
| mrkdwn ≠ markdown (`*bold*`, `<url                                                                                                       | text>`, no tables)                                               | the renderer's converter                                                                        | needs a **fixture corpus**, exactly like our other renderers |
| ~4,000 chars of readable text before the client truncates                                                                                | `files.upload` for anything longer                               | the report goes as a snippet; the message carries the verdict                                   |
| bot token `xoxb-`, app token `xapp-`, signing secret                                                                                     | secrets, injected at start                                       | **never in a snapshot** (shop.md §1.3)                                                          |

### 2.1 Multiplayer is the thing Slack gives us that a terminal cannot

Two humans can answer the same desk item at the same time. That is not a bug to prevent; it is the
reason to be on Slack. The rule:

```
  first valid desk.answer for an item wins and is recorded
  later answers are recorded too, with `supersedes: <first>` — never silently dropped
  an answer whose lease generation is stale is refused, so a reopened thread cannot resurrect
  a decision the bench has already acted on
```

And the corollary that keeps Slack from becoming a notification firehose: **one digest per scope per
hour, plus one message per item that actually needs a human.** A bench that posts every tool call
into a channel gets muted, and a muted surface is worse than no surface.

---

## 3. The mapping

```
  Slack                            ours                              notes
  ─────────────────────────────    ──────────────────────────────    ─────────────────────────────
  workspace (T0123)                the org                           one install = one org
  channel (#dev-1575)              a work.scope                      Amp does this: a channel linked
                                                                     to a Space routes @mentions in
  thread (thread_ts)               a session / room at a bench       persisted as a record, not a map
  message mentioning the bot       desk.item { kind, refs }          via desk.ingest, uri = slack:<id>
  Block Kit button                 desk.item.choices[].options[]     the answer is a record
  thread reply “approved”          desk.answer { values, note }      free text is a note, not a value
  :white_check_mark: reaction      ack (surface-level)               never a decision
  :arrows_counterclockwise:        retry / re-queue                  a new item, linked
  member presence / DND            attention.status                  who to route a review to
  file upload                      a blob by CID                     then cited by a record
```

Two mapping rules that prevent 90% of the bugs:

1. **A channel is a scope, not a conversation.** Conversations live in threads and in the bench; the
   channel is where the scope's digests land.
2. **Free text in a thread is a note, not an answer.** If a decision matters it gets a button; if it
   gets a button it gets a record. Everything else is `desk.item.body` commentary and may be
   superseded by the record.

---

## 4. Identity: a Slack user is not a DID

Slack gives us an install (team id) and a subject (user id). Neither is an identity we can use.

```jsonc
// dev.autotelic.link — the binding is explicit, recorded, and revocable
{
  "surface": "slack",
  "subject": "T0123/U0456",
  "did": "did:key:z6Mk…",
  "role": "reviewer",
  "at": "2026-11-20T…",
  "by": "did:web:autotelic.dev",
}
```

- **Never trust display names or emails.** `T0123/U0456` is a stable subject; “ted” is a claim.
- **The bot has its own identity** (the org's or the shop's DID), and it is the one that signs
  records. A message that merely _looks_ like it came from a human is untrusted text.
- **An allowlist is not a role.** `ALLOWED_USERS` decides who may talk to the bot; the `link` record
  decides what they may answer. Two questions, two mechanisms.
- **Revoking a link is a record**, so “who approved this in November” is answerable after they leave.

---

## 5. What not to build

| tempting                                 | why not                                                              | instead                                            |
| ---------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| a Slack-specific queue or state machine  | it becomes the real one the moment it is easier to check             | `desk.item`/`desk.answer`; Slack is a client       |
| per-user OAuth for every participant     | token refresh, scopes, revocation, storage — a product               | one bot token per install + a `link` record        |
| mirroring the whole room into Slack      | the channel becomes an unreliable transcript people trust            | digests + items + a link to the bench              |
| a Block Kit UI framework                 | every block is a renderer, and renderers drift                       | one `render(item) → blocks` function with fixtures |
| streaming tokens into a message          | rate limits, and it makes the message the transcript                 | update on milestones (started, blocked, done)      |
| Slack presence as the attention model    | presence ≠ interruptibility (`available/busy/dnd/until/delegate`)    | `attention.status`                                 |
| a public webhook because it is “simpler” | an inbound port, a signing secret, a tunnel, and a URL to keep alive | Socket Mode                                        |

---

## 6. The same three verbs, everywhere else

| surface                      | ingest                                          | answer                                               | render                                      | gotchas                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub**                   | webhooks; idempotency on `X-GitHub-Delivery`    | reviews, comments, label changes                     | status on the PR; one marker comment        | `CidConflict` ≠ replay; a filtered review is still a fact (\`unrouted\`)                                                                                              |
| **herdr / rex** (machinery)  | a thought injected into a live pass             | a steer, or a question answered before the pass ends | the live status, the question, the artifact | additive and unfenced by design: three steers at once is fine, because the lease holds the pen — but a **decision-shaped** sentence must be turned into an item, once |
| **terminal** (`bench inbox`) | a prompt typed by a human                       | Enter                                                | the desk, the journal, `--json`             | one writer: the CLI must refuse to answer while another person holds the item                                                                                         |
| **pi extension**             | a tool call                                     | a tool result                                        | the desk in the editor's border             | must not become a second renderer of jig's report                                                                                                                     |
| **phone viewer**             | nothing                                         | nothing                                              | read-only status + a mail link              | no writing from a surface without a fence                                                                                                                             |
| **Slack** (strategy)         | events (Socket Mode) + declared-channel context | buttons; prose is a note or a hint                   | projection + item + thread                  | the table in §2                                                                                                                                                       |

All five are the same shape, which is the point: **a new surface is a decoder and a renderer, never
a state machine.**

---

## 7. How we would know a surface is correct

Same discipline as the mailbox fixtures: record the surface's own bytes, replay them, and require the
_refusals_ to be as explicit as the successes.

```
  fixtures/surfaces/slack/
    app_mention.event.json          → one desk.item, kind fyi|approval
    block_actions.approve.json      → one desk.answer, values { decision: "approve" }
    block_actions.stale.json        → refused (Superseded / stale generation)
    retry.delivery_2.json           → identical item, no duplicate        (X-Slack-Retry-Num: 2)
    retry.reordered.json            → both admitted, order by event ts, not arrival
    duplicate.event_id.json         → Conflict, not replay
    huge.report.json                → snippet upload, message stays under the limit
    mrkdwn.corpus.md                → rendered blocks byte-compared
```

Eight files, and the last two are the ones that catch real regressions: the size cliff and the
formatting converter. Everything else is the idempotency discipline we already have.

---

## 8. Work plan for a Slack surface

Four increments, each one useful alone:

**S1 — read-only.** The bridge renders desk items and status digests into a channel. No answers. It
is a one-way projector, and it proves the mapping without risking a decision.
**S2 — answers.** Block Kit buttons → `desk.answer` records. First-valid-wins, later answers carry
`supersedes`. A stale generation is refused.
**S3 — thread = session.** ACP (or the bench's own RPC) behind the thread; streaming at milestone
granularity; long output as a snippet; permission prompts forwarded as items with choices.
**S4 — identity.** `link` records, roles, and an allowlist that is separate from a role.

Done-when for S2, which is the one that matters: **two humans click “approve” at the same time, the
bench acts once, both answers are in the log, and the second one says it superseded nothing.**

---

## 9. Risks

| risk                              | symptom                                     | mitigation                                                                          |
| --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Slack becomes the source of truth | a decision is only in a thread              | answers are records; the thread is a view                                           |
| notification fatigue              | the channel is muted in a week              | digests + items only; one message per human decision                                |
| mrkdwn drift                      | code blocks and tables render wrong         | converter + fixture corpus, byte-compared                                           |
| rate limits                       | `chat.update` silently drops                | milestone updates; backoff; never per-token                                         |
| token leakage                     | `xoxb-` in a snapshot or a log              | secrets after snapshot, redact on render (shop.md §1.3)                             |
| install sprawl                    | three workspaces, three bots, unclear owner | one bot per org, `link` records, a named owner                                      |
| replies that never become answers | a human decided, the bench never knew       | any decision-shaped text without a button is itself an item: “was that a decision?” |
