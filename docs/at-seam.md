# The AT seam

What Joel's tweet is actually proposing, what AT Protocol supplies, what we already built that
should have been his, and the one noun that makes a bench portable: a **scope, a lease, a desk,
a journal, and one PR** — every byte of it a lexicon.

Written after reading his lexicons, his mailbox app, the atproto specs (repository, lexicon,
data model, record key, permission, event stream), `goat`, and our own `protocol`, `board`,
`room`, and `jig` sources. Claims marked **verified** were read in the source; claims marked
**inferred** are design reasoning.

---

## 0. The tweet, in the form that can be answered

Three claims, only the third of which is about protocol:

1. **The social layer is the stickiest part of a harness.** Not the model loop, not the tools.
   The ability to _address_ another agent, send it work, and get an answer with provenance.
2. **Nobody else will implement it** — because it is not a library. It is identity + transport +
   schema + permissions, and it only pays off when both ends speak it.
3. **No vendor will federate** — so the only thing that spreads is a format nobody owns.

AT Protocol is his answer to (2). Rat King is his implementation of the answer. So our question is
not "should we use his CLI". It is: **which of our bytes are addressed to another agent, and do
those bytes have an identity, a schema, and a name that survives us.**

Four of our artifacts answer yes to "addressed to another agent":

| artifact               | who reads it                     | identity                       | schema              | name                         |
| ---------------------- | -------------------------------- | ------------------------------ | ------------------- | ---------------------------- |
| a room's inbox/outbox  | another session, another machine | none (local seq, actor string) | none (POST /inbox)  | none                         |
| a review request       | a reviewer's agent               | GitHub login                   | `inbox.kind: "turn" | "card"`                      | none |
| a finding + a baseline | a repo's future agents           | rule id string                 | `protocol` lexicon  | `report`, `baseline` (local) |
| a claim/lease          | a daemon on another host         | host + actor                   | `board.claim`       | none                         |

Two have a schema. None has an identity. None has a name that another codebase could look up.
That is the gap, stated precisely: **we built the record half of a protocol and none of the
identity half, for records that never leave the repo.**

---

## 0.5 The shape, before the protocol

One sentence: **a scope gets a place, the place has an agent that owns everything happening in that
scope, and the place has a name other agents can address.**

```
  a scope                       a place                          other places
  ───────                       ───────                          ────────────
  github label dev-1575  ──┐    ┌──────────────────────┐  mail   ┌──────────────────┐
  linear project DEV-…   ──┼───▶│ the bench            │◀───────▶│ a reviewer's     │
  base branch develop    ──┘    │  one name (DID)      │         │ bench            │
                                │  one lease           │  mail   └──────────────────┘
                                │  one room            │◀───────▶┌──────────────────┐
                                │  all of the work     │         │ another scope's  │
                                └──────────┬───────────┘         │ bench            │
                                           │                     └──────────────────┘
                                           ▼
                                  one pull request
```

### “All of the work” is four verbs

```
  INTAKE      every PR comment, review, CI result, label change and ticket lands in the place.
              Nothing that happens to the scope is discovered by re-reading GitHub later.
  DECIDE      each thing is classified: act now, next, later, never; or “a human must choose”.
              The classification is recorded, so a second run does not relitigate it.
  DO          the agent develops: worktree, tools, checks, commits. It does not wait to be
              prompted for the next item, and it does not need a human to hold the thread.
  SHIP        one change, one PR, with its evidence attached — the checks it ran, the findings
              it accepted, the reviews it requested and received.
```

The invariant that makes it a _place_ and not a _process_: **the agent can be restarted, moved to
another machine, or replaced, and none of the four verbs lose their position.** Anything held only
in a process is not held at all.

### What a place is made of

```
  a name        who it is, so others can address it and so work survives its host
  a lease       exactly one writer at a time, and a fence so an old writer cannot act
  a journal     what was said and done, committed before it is shown
  a mailbox     how other agents reach it, and how it reaches them
  a desk        what is waiting on a human, answerable in place
  a machine     where the tools run (optional: it can be this laptop)
```

Five of those six are the same six a person would want for a job they are responsible for, which is
the point: the agent is not a chatbot with tools, it is the _occupant of a post_.

### What it is not

- Not a session. A session is a borrower; a place outlives it.
- Not a branch or a machine. Those are things it uses.
- Not a chat room. A room is where you talk to it; the place is what it is responsible for.
- Not an app. The reviewer's place is somebody else's software.

### Why this needs a protocol and not an integration

The second place is always someone else's. The moment a bench must ask a reviewer's bench for a
review, or another scope's bench for a decision, it is crossing an organizational boundary — a
different vendor, a different model, a different machine, eventually a different company. An SDK
cannot cross that; a format can. So the place needs three things that do not belong to us:

1. a **name** that resolves without our server (a DID),
2. a **schema** the other side can implement from a document (a lexicon),
3. a **mailbox** with receipts, so “not answered” and “never arrived” are different facts.

Everything else — the nouns, the CLI, the checks, the ratchet — is ours and can be whatever we
like. That is the whole seam: **three borrowed things, so the places can talk; everything else is
local.**

### The acceptance test

Not a benchmark and not a demo. This repo has a work thread in `docs/threads/at-seam` that two
sessions maintain by hand: numbered turns, append-only votes, one writer, replayable after a
restart. If that conversation can move into a place — addressed by name and time, with receipts,
and survive both sessions restarting — then the place exists and a bench is an assembly of parts we
already have. If it cannot, nothing above it matters yet.

## 1. What AT Protocol actually is

Five atoms, and the reason each one matters to us:

```
                        IDENTITY                  DATA                        OPERATIONS
                    ┌──────────────┐      ┌───────────────────────────┐   ┌────────────────────┐
   an agent  ──────▶│ DID          │─────▶│ PDS (personal data server)│   │ XRPC               │
                    │ did:plc:…    │      │  repo = signed MST        │   │ POST /xrpc/<nsid>  │
                    │ doc: keys,   │      │  at://did/collection/rkey │   │ JWT iss=DID        │
                    │ PDS location │      │  record → DRISL-CBOR → CID│   │ aud=service lxm=…  │
                    └──────────────┘      │  commit → signature       │   └────────────────────┘
                                          └────────────┬──────────────┘
                                                       │ subscribeRepos (CBOR over WS)
                                                       ▼
                                          ┌──────────────────────┐   ┌───────────────────┐
                                          │ relay / firehose     │──▶│ AppView (indexer) │
                                          └──────────────────────┘   └───────────────────┘

  lexicon = schema for one collection (record) or one XRPC method (query | procedure | subscription)
  NSID    = its globally unique name, resolved through DNS: _lexicon.autotelic.dev TXT "did=…"
```

Verified specifics that change our design, not just our vocabulary:

**1. A lexicon is a published record, not a file in your repo.** Lexicons live at
`at://<did>/com.atproto.lexicon.schema/<nsid>` and resolve by DNS TXT. That means
`dev.autotelic.work.scope` is a _thing an atproto SDK can find_ if we publish it — no vendor, no
registry account, no gatekeeper. (`goat lex publish`, verified.)

**2. The evolution rule is already ours, and already implemented twice.** atproto: "After
publication, new fields stay optional… breaking changes need a new NSID." Ours:
`lexicon.ts` — "you may ADD AN OPTIONAL FIELD… A breaking change is a NEW LEXICON NAME."
`goat lex breaking` is the structural half of our `scripts/lexicon-compat.mjs`; our frozen
fixture corpus is the half `goat` does not have (it diffs schemas; we validate bytes). We
independently reinvented a spec, and got the _stronger_ check.

**3. Floats are forbidden in the data model.** Verified, with a "Why No Floats?" section. Our
`report.diagnostic` carries `score: number` and `confidence: number`; our `joggle` verdicts are
floats. Rat King's `triage.verdict` carries `probabilityBp` for exactly this reason. Any of our
records that becomes an AT record must move to basis points — and it should move _now_, because
the same argument (re-encoding is not round-trip stable) is true of JSON→SQLite→JSON too.

**4. A repository is not a log.** Verified: "Record deletion is supported without leaving a trace
or tombstone." Our inbox, our receipts, and our audit trail _require_ the opposite. So a bench
needs three tiers, and Rat King is already shaped this way:

```
  tier 1  repo records      public, self-certifying, deletable, small, per-DID
                            → scope, ship, baseline entries, published lexicons
  tier 2  sequenced log     private, append-only, fenced, per-DID, no deletion
                            → inbox, receipts, delivery states  (his Mailbox DO, our ledger)
  tier 3  blobs             content-addressed by CID, referenced from tier-1 records
                            → a catalog, a report, a menu, a rendered diff
```

**5. Record keys are the index, and they are user data.** `tid` (chronological), `literal:self`
(one per collection), `any` (semantic). Our baseline has a stable identity hash per finding — a
perfect `any` rkey. Our chits have derived ids — also fine. Our epoch-ms timestamps and
`t`-prefixed ids are _not_; the wire wants RFC3339 datetime strings and TIDs.

**6. Permission sets beat shared secrets for delegation.** Verified: `repo:<nsid>?action=create`,
`rpc:<lxm>?aud=<did#service>`, bundled as a `permission-set` lexicon and granted through OAuth.
Joel's answer in the XRPC world is `sh.ratking.pass`:

```json
{
  "v": 1,
  "worker": "did:…",
  "desk": "…",
  "deskDid": "did:…",
  "run": "dev-1575:…",
  "scope": ["mailbox.send", "desk.answer"],
  "iat": 1763000000,
  "exp": 1763003600,
  "nonce": "…"
}
```

A boot worker gets a signed pass, not a key. Our agents currently get _the environment_. That is
the single largest security-shaped ergonomic we are missing.

---

## 2. What Rat King is, verified

**71 lexicon sources across thirteen NSID groups** (`packages/lexicon/manifest.json`), generated
to Effect schemas, drift-checked by `lexgen:check`, with typed XRPC server and client layers.
The dependency list is the whole story: `@atproto/lexicon`, `@atproto/lex-data`,
`@ipld/dag-cbor`, `effect`.

```
  mailbox.*    14   send list ack deliver subscribe markRead getPresence listTraffic sendViaPass …
  runtime.*     5   acquireLease renewLease releaseLease resolveLease lease(object)
  desk.*       14   item(answerable record) answer(record) ingest ack pending inbox fork bindProject …
  identity.*   12   register retireName unretireName setSuccessor enrollHost setRole listRetired …
  attention.*   7   status(prefs) receipt getStatus putStatus
  agentgraph.*  6   plan turn outcome checkin friction wake
  triage.*      2   judge verdict
  rulegarden.*  2   finding event
  device.*      2, admin 1, agent 1, defs 1, sh.ratking 5 (pass invite ticket identity revocation)
```

And the deployment reality, from `apps/mailbox/README.md` — **"Local proof only"**: one Cloudflare
Durable Object per recipient DID, SQLite transactions, self-hosted XRPC, `did:web` documents
provisioned by an operator, and _no PDS_. **The PDS/repo phase is the roadmap item, not the
shipped thing.** This is the most important correction to any "just adopt it" plan: we would be
adopting his _lexicons and service shape_, not his hosting, and the repo tier comes later for
both of us.

Three of his mechanisms are worth stealing regardless of transport:

**The fence, verbatim** (`apps/mailbox/src/lease.ts`):

```ts
export interface Fence {
  readonly leaseId: string
  readonly generation: number
}

export const validLease = (tx: Transaction, fence: Fence, now: number) => {
  const lease = tx.lease()
  if (
    !lease ||
    lease.leaseId !== fence.leaseId ||
    lease.generation !== fence.generation ||
    lease.expiresAt <= now
  ) {
    throw failure("LeaseMismatch", 409) // refused, never ignored
  }
  return lease
}

const expiry = (now: number, requested: string) => Math.min(Date.parse(requested), now + 300_000)
```

Two details we would have gotten wrong: **acquire never steals** (it refuses and the caller must
retry at `generation + 1`), and **expiry is clamped to five minutes**, so a lease is a heartbeat,
not a 12-hour claim. Our `Driver` holds twelve hours; a stale-grip window of twelve hours is
twelve hours of a bench that cannot be taken over.

**Idempotent ingest, keyed by content** (`lexicons/sh/mschf/ratking/desk/ingest.json`): "the same
uri and cid returns the stored seq with stored false; the same uri with another cid is refused and
logged." Our `POST /ingest` dedupes on `x-github-delivery` and silently ignores the collision; his
distinguishes _replay_ from _conflict_, and a conflict is an error you can see. Our `ledger.append`
returns `false` for both.

**Cards that can be answered** (`desk.item` record): `kind: decision | approval | blocked | done |
fyi`, `choices[{key,label,suggest,options[{id,label,outcome}]}]`, `rows[{key,label,items[{v,label,on}]}]`
and `desk.answer` as a **record** with `values`, `rows`, `note`, `inReplyTo: tid`. Our card is
`{kind: "card", pr, text}`. The difference is not UI: his answer is evidence, addressable and
replayable; ours is a line in a transcript.

---

## 3. What we built, measured against it

### 3.1 The record layer: ours vs his, field by field

Our `protocol` registry is a real lexicon system that happens to use a different word for NSID:

```ts
// packages/protocol/src/lexicon.ts — ours
export interface LexiconRef {
  readonly name: LexiconName
  readonly version: number
}
```

```
// theirs — a record in the data model
{ "$type": "sh.mschf.ratking.desk.item", … }        // versioning = a new NSID, not a version int
```

Same rule, weaker name: `{name: "report", version: 1}` is unique inside our workspace.
`dev.autotelic.jig.report` is unique on Earth and resolvable by DNS. Nothing else about our
registry has to change to make that swap; `isLexiconName` becomes `isNsid`, `LENS` names get a
prefix, and the compat corpus keeps its job.

### 3.2 The convergence nobody planned: our diagnostic _is_ his finding

```
  our protocol/report.json diagnosis          sh.mschf.rulegarden.finding
  ─────────────────────────────────           ─────────────────────────────────
  engine          "plumb"                     owner            "…"           (rule author)
  ruleId          "duplicate-component"       id               sha256[64]    (finding identity)
  severity        error|warn|info             severity         high|medium|low
  message         "…"                         claim            "…"  (x-max 1200)
  help            "…"                         proposal         "…"  (x-max 1600)
  location {file,line,column,…}               spans [{host,path,line,quote,sha256}]   ← plural
  identity        "<stable hash>"             (id is the hash)
  judged          true                        kind principle|contradiction|bloat|stale
  score/confidence  number ← FORBIDDEN in AT   (verdict lives in triage/verdict, as probabilityBp)
  repair {operation, keep, remove, edits[]}   action  adopt-principle|delete|replace|narrow|merge|…
  —                                           evidence[], principles[], bytesSaved, wave, at
```

We converge on the same object from opposite directions: we judge _code_, he judges _instructions_.
Both need multi-span evidence (ours has one location), both need a stable identity (we have it), both
need an actionable verb (ours is richer), and his `triage.verdict` is our `judged` + `modelId` +
`probabilityBp`. **This is the artifact where adopting his shape costs us almost nothing and buys us
the entire federation story** — see §6.

### 3.3 The conversation: one-for-one, endpoint by endpoint

```
  ours (room/src/api.ts)              NSID it should have been
  ──────────────────────────────      ────────────────────────────────────────────
  POST /ingest {x-github-delivery}    sh.mschf.ratking.desk.ingest  {desk, item{uri,cid,…}}
  GET  /inbox?after&limit             sh.mschf.ratking.mailbox.list {afterSeq, throughSeq}
  POST /inbox {id,kind,pr,text}       sh.mschf.ratking.mailbox.send {envelope, leaseId, generation}
  POST /inbox/ack {seqs}              sh.mschf.ratking.mailbox.ack
  POST /presence {host,actor,ttl}     sh.mschf.ratking.attention.status (or getPresence)
  POST /jobs/claim {host}             sh.mschf.ratking.runtime.acquireLease
  POST /jobs/finish                   sh.mschf.ratking.agentgraph.outcome
  GET  /board                         sh.mschf.ratking.desk.inbox + agentgraph.plan
  driver.json {sessionId,…,12h}       sh.mschf.ratking.runtime.lease {leaseId, generation, ≤5min}
```

Every line of the right column exists. The left column is 1,321 lines of CLI, 1,472 of commands,
and 368 of HTTP for semantics that are published. The _brain_ behind it — `policy.ts`,
`personal.ts`, `review.ts`, `ingest.ts`'s event union — is ours and is the valuable part. That is
the deletion we should be willing to make (§7).

### 3.4 The two things we have that he does not

- **A ratchet.** `baseline` by identity + frozen compat fixtures + deterministic replay. Nothing
  in his 71 lexicons records "this finding was accepted at this revision and may not regress".
  This is _the_ candidate for what we contribute back.
- **Judgement with a census.** `joggle calibrate`, the question classification, the judged
  panel. A protocol cannot encode "the zero was earned". It can only carry the verdict.

---

## 4. The bench

Amp's orbs are the ergonomic reference; the noun is ours. (Woodworking: the **bench** is the
station the work lives on; the **vise** holds one piece; the **jig** holds it for one cut; the
**board** is the material; the **room** is the conversation at the bench.)

> **A bench is a durable station for one scope — a GitHub label and/or a Linear project — owned
> by one DID, held by one vise, with one room, and exactly one product: a single PR carrying its
> own evidence.**

```
        ┌──────────────────────────── BENCH (did:plc:dev-1575) ────────────────────────────┐
        │  scope   repo=Shakti/forestbuilder  label=dev-1575  project=lin:…  base=develop  │
        │  vise    runtime.lease { leaseId, generation, expiresAt ≤ 5m, harness#pi{…} }     │
        │  room    agentgraph.turn* / the pi-durable journal (local, durable)              │
        │  desk    desk.item* (answerable)  desk.answer*                                   │
        │  hands   gh · linear · git · herdr pane · agentOS/rexbox machine                 │
        │  checks  jig (plumb · joggle · cutlist) · pnpm test                              │
        │  product ship record + ONE pull request                                          │
        └───────────────────────────────────┬──────────────────────────────────────────────┘
                                            │  mailbox.send  (review request, wakeReason "ask")
                                            ▼
                             ┌──────────────────────────────┐
                             │ reviewer DID (its own bench) │
                             │  desk.answer → gh review     │
                             └──────────────────────────────┘
```

### 4.1 Lifecycle

```
   dormant ──up──▶ restored ──wake──▶ working ──idle 5m──▶ paused ──say/ship──▶ working
      │               │                  │                                        │
      │               └─ snapshot(sha,config,setupHash)  ← invalidated by a base commit
      │                                  ├── blocked ──(desk.item kind=blocked)──▶ paused
      └──retire◀── shipped ◀──ship────── ┘                                         │
                                    └────────── reopen (a comment lands) ◀─────────┘
```

Ten rules, in the order they matter (Amp's diagram, our words): one noun and six verbs; zero-config
start; **the repo declares its environment** (`.agents/setup`, `.agents/resume`,
`bench/checks.json`); snapshots are invisible; pause is automatic and free; **ship is a policy**
(`trunk | branch | custom`); the machine is a keystroke away; benches spawn benches with the same
noun; secrets are passes, not copies; and one place to look.

### 4.2 The vise

```
 time ───────────────────────────────────────────────────────────────────────────────▶
 bench A  ├─ acquire gen 1 ── renew ── renew ──✗ crash ──(expires ≤5m)────────────────
 bench B                                          ├─ acquire gen 2 ── renew ── …
 stale send from A ─────────────────────────────▶│ refused: LeaseMismatch (409)
 worst-case takeover window = the clamp, not the TTL  ← the whole reason to copy his numbers
```

### 4.3 The loop

```
 GitHub comment on #1864 ──webhook(delivery=uri)──▶ desk.ingest { uri, cid }
        │  same uri+cid → seq, stored:false          same uri, new cid → CidConflict
        ▼
 vise holder: desk.pending → triage.judge → triage.verdict (Now | Next | Later | Never)
        ├─ needs a human ──▶ desk.item{kind:"approval", choices[…], refs:["gh:1864#c…"]}
        └─ no action ──────▶ desk.item{kind:"fyi"} + agentgraph.turn
 review request out ──▶ mailbox.send{to: reviewerDid, wakeReason:"ask", leaseId, generation}
 reviewer's agent ────▶ desk.answer{itemId, inReplyTo: tid, values:{decision:"approve"}, note}
        ▼
 gh adapter posts exactly one review ──▶ agentgraph.outcome ──▶ ship record ──▶ PR
```

Every arrow is a lexicon call or a record. That is what "perfectly portable" means here: a second
implementation is a weekend because there is nothing left to guess.

---

## 5. The records we must add, and where each one lives

Everything a bench says that his vocabulary does not already have, with the tier it belongs to
from the tiering in §1.5 (`t1` repo record, `t2` sequenced log, `t3` blob).

| NSID                             | tier                  | key                              | what it is                                                           |
| -------------------------------- | --------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `dev.autotelic.work.scope`       | t1                    | `any` (`<owner>.<repo>~<label>`) | the scope a bench owns                                               |
| `dev.autotelic.work.ship`        | t1                    | `tid`                            | the product: one PR and its evidence                                 |
| `dev.autotelic.work.item`        | **t2 default**        | `tid`                            | the claimable unit (our `chit`), published to t1 only inside a space |
| `dev.autotelic.jig.acceptance`   | t1 + committed ledger | `tid`                            | an `accept`/`drop` event; the baseline is a fold over these          |
| `dev.autotelic.finding`          | t1 (space) / t2       | `tid`                            | a finding, sharing his envelope, keeping our judgement               |
| `dev.autotelic.rule`             | t1                    | `nsid`                           | a rule with an author DID and a version                              |
| `dev.autotelic.question.verdict` | t1                    | `tid`                            | one judged question: the numerator of calibration                    |
| `dev.autotelic.rule.adoption`    | t1                    | `tid`                            | a periodic count snapshot: the denominator                           |

### 5.1 `work.scope` and `work.ship`

```json
{
  "lexicon": 1,
  "id": "dev.autotelic.work.scope",
  "defs": {
    "main": {
      "type": "record",
      "key": "any",
      "description": "One bench: the scope it owns. Key is '<owner>.<repo>~<label>'.",
      "record": {
        "type": "object",
        "required": ["repo", "label", "desk", "updatedAt"],
        "properties": {
          "repo": { "type": "string" },
          "label": { "type": "string" },
          "project": { "type": "string", "description": "Linear project id." },
          "base": { "type": "string" },
          "desk": { "type": "string", "format": "did" },
          "reviewers": { "type": "array", "items": { "type": "string", "format": "did" } },
          "ship": { "type": "string", "knownValues": ["trunk", "branch", "custom"] },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

```json
{
  "lexicon": 1,
  "id": "dev.autotelic.work.ship",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "The single product of a bench run: one PR and its evidence.",
      "record": {
        "type": "object",
        "required": ["scope", "pr", "sha", "base", "branch", "state", "at"],
        "properties": {
          "scope": { "type": "string", "format": "at-uri" },
          "pr": { "type": "integer" },
          "sha": { "type": "string" },
          "base": { "type": "string" },
          "branch": { "type": "string" },
          "state": { "type": "string", "knownValues": ["draft", "open", "merged", "closed"] },
          "baseline": { "type": "ref", "ref": "com.atproto.repo.strongRef" },
          "findings": {
            "type": "array",
            "items": { "type": "ref", "ref": "com.atproto.repo.strongRef" }
          },
          "checks": { "type": "array", "items": { "type": "ref", "ref": "#check" } },
          "at": { "type": "string", "format": "datetime" }
        }
      }
    },
    "check": {
      "type": "object",
      "required": ["name", "ok"],
      "properties": {
        "name": { "type": "string" },
        "ok": { "type": "boolean" },
        "ran": {
          "type": "boolean",
          "description": "false = not looked at. Never render false as zero."
        },
        "report": { "type": "ref", "ref": "com.atproto.repo.strongRef" }
      }
    }
  }
}
```

### 5.2 The baseline is a fold, not a set

My first draft had “one record per accepted finding, keyed by identity, so the collection IS the
baseline”. It is wrong twice: `jig check` must run keyless and offline in CI, and a record set
cannot express “we stopped accepting this, and why” because atproto deletes without a tombstone.

So acceptance is an **event**:

```json
{
  "lexicon": 1,
  "id": "dev.autotelic.jig.acceptance",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "One acceptance decision. The baseline is a fold over these in TID order.",
      "record": {
        "type": "object",
        "required": ["identity", "action", "engine", "rule", "at"],
        "properties": {
          "identity": {
            "type": "string",
            "description": "The finding's stable identity: rule + membership, never a content hash."
          },
          "action": { "type": "string", "knownValues": ["accept", "drop"] },
          "engine": { "type": "string" },
          "rule": { "type": "string" },
          "path": { "type": "string" },
          "reason": { "type": "string" },
          "sha": { "type": "string", "description": "The commit the decision was made at." },
          "at": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

```
  .jig/acceptance.jsonl        ← committed, append-only, the GATE's authority (no network)
        │  fold in TID order
        ▼
  .jig-baseline.json           ← derived cache: { lexicon, provenance{uri,cid}, entries[] }
        │
        └─► repo records           ← the same events as records, for provenance
              └─► ship.baseline    ← strongRef to the CID the gate was actually run against
```

Three properties at once: the gate stays dumb and offline; retirement is an event so nothing is
ever deleted; and history is durable without a second store.

### 5.3 `work.item`: the claimable unit

Neither `desk.item` (a decision) nor `agentgraph.turn` (a trace) has a claim, a fencing epoch, an
anchor, or a state machine. Our `chit` does, and it is one of the two things we built that is
genuinely new. It defaults to **tier 2** — items are chatty and carry paths and PR numbers — and
is published only inside a space.

```json
{
  "lexicon": 1,
  "id": "dev.autotelic.work.item",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "A claimable unit of work, held under a fencing lease. Tier 2 unless published in a space.",
      "record": {
        "type": "object",
        "required": ["scope", "kind", "state", "updatedAt"],
        "properties": {
          "scope": { "type": "string", "format": "at-uri" },
          "kind": { "type": "string", "knownValues": ["build", "thread", "review", "external"] },
          "state": {
            "type": "string",
            "knownValues": [
              "open",
              "claimed",
              "working",
              "blocked",
              "proposed",
              "in_review",
              "changes",
              "approved",
              "merged",
              "deployed",
              "closed",
              "orphaned",
              "abandoned"
            ]
          },
          "anchor": {
            "type": "ref",
            "ref": "#anchor",
            "description": "Where it can be picked up: PR, sha, path, line, comment."
          },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    },
    "anchor": {
      "type": "object",
      "required": ["pr", "sha"],
      "properties": {
        "pr": { "type": "integer" },
        "sha": { "type": "string" },
        "path": { "type": "string" },
        "line": { "type": "integer" },
        "commentId": { "type": "integer" }
      }
    }
  }
}
```

The mapping that has to be written down, because it is where an adapter would otherwise guess:

```
  work.item.state    desk.item.kind                   agentgraph
  ───────────────    ─────────────────────────────    ─────────────────────
  blocked            blocked                          —
  in_review/changes  approval (it wants a decision)   —
  working/claimed    —                                turn (what is happening now)
  merged/deployed    done                             outcome
  open               fyi                              plan
```

`desk.item.kind` is a **decision** a human must make; `work.item.state` is a **phase** the work is
in. An adapter writes `item.state` and derives a `desk.item` only when a human is needed.

### 5.4 `finding`: share the envelope, keep the judgement

We converged on `sh.mschf.rulegarden.finding` from the opposite direction, so the adoption costs
one rename and buys the whole federation story. Three rules for the merge:

**Share:** `id`, `spans[{host,path,line,quote,sha256}]` (plural — ours has one location), `claim`,
`evidence[]`, `action`, `at`, and `x-strict`.

**Keep separate:** `severity` (ours: the gate's `error|warn|info`) is not his `severity`
(`high|medium|low`, importance). Do not map them — an `info` finding can be important and an
`error` can be trivial. Keep `severity`; add `importance` only if a consumer needs it.

**Do not force:** his `kind` (`principle|contradiction|bloat|stale`) is instruction-file semantics.
Code findings do not fit it, and pretending they do is how one record type becomes two half-types.
Leave `kind` open and let the adapter that judges rulebooks set it.

And the line to strike from my earlier table: `id` (a content hash) is not our `identity` (meaning:
rule + membership). A wording change must not reopen a baseline. Publish both; the record key is
the hash, the baseline keys on identity.

### 5.5 The two calibration records

`joggle calibrate` asks _which questions does this rulebook get wrong_. A verdict alone cannot
answer it — that is a sample without a denominator.

```json
{
  "lexicon": 1,
  "id": "dev.autotelic.question.verdict",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "One judged question: the numerator of calibration. No paths, no messages.",
      "record": {
        "type": "object",
        "required": [
          "rule",
          "ruleVersion",
          "question",
          "questionVersion",
          "probabilityBp",
          "outcome",
          "at"
        ],
        "properties": {
          "rule": { "type": "string", "format": "nsid" },
          "ruleVersion": { "type": "integer" },
          "question": { "type": "string" },
          "questionVersion": { "type": "integer" },
          "model": { "type": "string" },
          "probabilityBp": { "type": "integer", "minimum": 0, "maximum": 10000 },
          "outcome": { "type": "string" },
          "disagreement": {
            "type": "boolean",
            "description": "The panel split. The signal calibration is looking for."
          },
          "at": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

```json
{
  "lexicon": 1,
  "id": "dev.autotelic.rule.adoption",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "description": "A periodic count snapshot: the denominator of calibration. Counts only, opt-in.",
      "record": {
        "type": "object",
        "required": [
          "rule",
          "ruleVersion",
          "period",
          "repos",
          "runs",
          "candidates",
          "judged",
          "at"
        ],
        "properties": {
          "rule": { "type": "string", "format": "nsid" },
          "ruleVersion": { "type": "integer" },
          "period": {
            "type": "string",
            "description": "Coarse bucket: 2026-W47. Never a precise timestamp."
          },
          "repos": { "type": "integer" },
          "runs": { "type": "integer" },
          "candidates": { "type": "integer" },
          "judged": { "type": "integer" },
          "at": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

This is the one record where a bench reports a number about a repo it does not own — which is why
it is counts, coarse time, and opt-in, and why it is a separate record from the verdict.

---

## 6. The ambitious part, corrected

Once a finding is a record with an identity and a DID, four things that are impossible today
become small. One of them, as first written, was a fantasy; it is replaced below.

**6.1 The baseline is a fold.** The committed ledger is the gate; the event log is the history; the
repo records are the provenance; the ship cites the CID. “Which baseline?” is a file path for the
gate and an `at://…` for a stranger.

```
  today:  .jig-baseline.json  ← a file whose provenance is a git blame
  bench:  .jig/acceptance.jsonl (folded)  +  records at at://did:plc:shakti/dev.autotelic.jig.acceptance
          +  work.ship.baseline → the CID the gate was actually run against
```

**6.2 A rule has an author.** `engine` + `rule` become `dev.autotelic.rule` records owned by a DID.
“Who says classnames must be sorted” gets a key, a version, and a history; `plumb` becomes a
_consumer_ of rules rather than the only place they exist. Rules can be forked and retired.

**6.3 Calibration federates. Findings do not.** This is the correction I got wrong. A global feed
of `dev.autotelic.finding` is a surveillance surface before it is a scaling problem: findings carry
paths, messages, and usually code context, and somebody has to run the relay.

What is safe to publish is the _verdict_, and what makes it a **rate** rather than a sample is the
_adoption snapshot_. Together:

```
        ┌──────────── plumb/jig (rule author DID) ─────────────┐
        │ publishes rule records + lexicons                    │
        └───────────────┬──────────────────────────────────────┘
                        │  DNS: _lexicon.autotelic.dev → did
        ┌───────────────▼───────────────┐      ┌────────────────────────────────────┐
        │ repo A  adoption + verdicts   │─────▶│ population: which questions does   │
        │ repo B  adoption + verdicts   │─────▶│ this rulebook get wrong, everywhere│
        └───────────────────────────────┘      └────────────────────────────────────┘
         no paths, no messages, counts and outcomes only

        findings themselves federate only inside permissioned spaces or opted-in orgs
```

So `joggle calibrate` becomes a population question without leaking a tree, and it is still the
only version of this that gets better with more users.

The org's timestamps are its **own observations**, and an observation is a **command**, never a read:

```
  observe <repo>   command → Observed { repo, records[], at }   signed by the org, cites the CIDs read
  fold             pure    → state + observedThrough + stale    no clock writes, ever
```

`Observed` cites the record CIDs it read, or "observed at T" is a claim about the world rather than
about bytes — and a stale mirror looks exactly like a fresh read. The fold stays pure so a dashboard
can poll it; a person, or a threshold crossing, calls `observe`. Mutation-on-GET with extra steps is
still mutation-on-GET.

**6.4 A review request is mail, not a Slack message.** The reviewer's `desk.answer` is a record
with `inReplyTo` — so a review's provenance survives the PR, the repo, and the tool. The same
`mailbox.send` carries the jig-CLI feedback we already field with `pi-intercom`, which is the
proof of concept: we have been doing this by hand with a local socket.

**6.5 The outbox, which neither of us saw at first.** The fence is sender-side: a sender holding a
live lease must carry `{leaseId, generation}`, and an unfenced send is allowed only when there is
no live lease. So a session that does not hold the vise **cannot send at all**. Mail is therefore
not a synchronous call for a bench:

```
  session (no vise)                     vise holder                     mailbox
  ─────────────────                     ───────────                     ───────
  say / request review
    └─ commit to outbox (local, durable)  ← pi-durable's “commit before show”
                                        flush with {leaseId, generation} ──▶ accepted
                                        idempotent on (senderDid, TID)  ◀── receipt{seq}
  ack locally  ──────────────────────▶  flush acks after the commit      ──▶ acked
```

Two calls this forces: the outbox is a **store, not a lexicon** (it is our implementation of
durability, not a wire object — inventing `dev.autotelic.outbox` would be protocol theatre), and a
flushed send must be idempotent on `(senderDid, TID)` so a retry is a replay rather than a second
letter.

---

## 7. What we delete, and in what order

The honest consequence of “we are not beholden to room and board”.

```
  KEEP (ours, valuable)              DELETE (his, better)            KEEP AS ADAPTER
  ─────────────────────────────      ──────────────────────────      ──────────────────────────
  policy.ts  shouldReview            room's HTTP surface             gh.ts      → desk.ingest
  personal.ts planReviews            board's claims table            linear.ts  → desk.ingest
  review.ts  runReview/promptOf      inbox(kind:turn|card)           git.ts     → ship record
  ingest.ts  the event union         driver.json + 12h Driver        herdr      → the pane
  protocol/* compat + fixtures       jobs state machine              pi-durable → the journal
  joggle     the judgement           sqlite as the shared truth
  the MARKER (idempotent review post under webhook redelivery)
  board's fence INVARIANTS (acquire / nextEpoch / conflicts)
  “not looked at ≠ zero” in the review prompt
```

The marker and the fence invariants are the two things most likely to be lost in a rewrite and
most expensive to rediscover: one is an idempotency key for an external effect, the other is the
only thing keeping two machines from claiming one item.

### Order

0a. **Vocabulary, offline.** NSIDs in our schemas; `score` / `confidence` / `durationMs` → integers
(`probabilityBp`, `elapsedMs`); adopt `x-strict` and `*.defs`; **delete the legacy
`protocolVersion` branch** — lexicon v1 cannot express it, which is the protocol telling us to
drop a scar. This is a break under our own rule: new NSIDs, fixtures regenerated. Nothing
published, nothing network-dependent, no external consumers.
0b. **Publication.** Lands with the repo (step 4). `goat lex publish` needs a PDS, so publishing
first would publish a guess.

1. **The vise.** `Driver` becomes `runtime.lease`: request 60s, renew at 20s (the five-minute clamp
   is a ceiling, not a target), acquire-never-steals, `generation + 1` takeover, release on sleep
   rather than waiting for expiry. Every inbox/ack/job write carries `{leaseId, generation}`.
   This is a day's work and it fixes a real bug: two clients can double-post and a resurrected
   daemon can ack.
2. **The desk, and `work.item`.** `inbox.kind` becomes `desk.item` with `choices` / `rows`; acks
   become `desk.answer` records; `/ingest` becomes `desk.ingest` with uri+cid idempotency
   (replay ≠ conflict). `chit` becomes `work.item` with the state mapping written down first.
3. **The wire.** A mailbox service: `send / list / ack / lease`, idempotent on `(senderDid, TID)`,
   with the sequenced log and the fence. Start without `subscribe` and without `deliver`: polling
   `list(afterSeq)` is the honest path, and in a request/response thread the next turn is the ack.
   Ship identity first (`identity.register` + `admin.putDidDocument`) or there is nothing to lease.
4. **The repo.** A PDS per bench DID: `work.scope`, `work.ship`, `jig.acceptance`, published
   lexicons, blobs for catalogs and reports. `jig check` gains `--baseline at://…` as a
   _verification_ of the committed ledger, never as the CI path.

One supervisor per repo, ever: in bench mode a plist (if any) points at the **bench**, never at
treadle; a child that exits on lease loss must not be restarted by KeepAlive. Standalone keeps
launchd → treadle. Never both.

---

## 8. What I verified, what is inferred, and the walls

**Verified by reading:** the 71 lexicons and their fields; `validLease`; the five-minute clamp;
acquire-never-steals; the sender-side fence; uri+cid conflict semantics; `desk.item` / `answer`
shapes; `sh.ratking.pass`; the mailbox README's “Local proof only” and DO-per-DID design; the
subscribe watermark barrier and “listing never mutates delivery”; atproto's no-floats rule;
no-tombstone deletion; `key` types; `goat lex breaking/lint/publish`; lexicons published as records
resolved by DNS; permission sets and `repo:` / `rpc:` scopes; the absence of a Spaces spec page.

**The wall that decides the choreography:** lexicon v1 has no `anyOf` and no schema-level closure
(his `x-strict` is the workaround). We have 18 floats across 6 schemas, 59 closed objects, and 3
schemas whose top level is `anyOf [{required:["lexicon"]}, {required:["protocolVersion"]}]`. So
converting is not a lint pass — it deletes our legacy branch, which is the good outcome.

**Inferred:** that a bench's inbox is tier 2 rather than repo records; that `desk` covers our card
semantics; that a 60s lease is enough for a bench whose vise is the environment.

**Still unknown:**

- His two `kind` enums (`desk.item.kind` = decision, `desk.defs.ownerItem.kind` = queue) — which is
  canonical, and is one a projection of the other?
- Does `desk` or `agentgraph` own the work trace? Both can describe a run today.
- Is `x-strict` his extension or a proposal upstream?
- Spaces timeline — it decides how much of tier 1 a bench may plan for.
- Are his HPKE envelopes (“unreviewed”) the answer for private records, or do we wait for spaces?
- Does `rulegarden.finding` grow our fields, or do we publish beside it and cross-cite?
