# The shop

Small durable containers, one machine running several, and a mesh that lets them talk.

This is the working document. It is deliberately bigger than the first slice we build: §8 cuts it
into milestones, and everything before that is the shape those milestones are supposed to reach.

Read with `docs/at-seam.md` (the coordination protocol: name, lease, mailbox, desk, findings). This
document is about the **container** those protocols live inside, the **machine** that hosts a
handful of them, and the **network** they speak over.

---

## 0. What we are building

Three objects, one per scale:

```
  bench     one durable container for one scope. Has everything the agent needs to work through
            a problem without asking for anything: the worktree, the tools, the credentials, the
            services, the checks, the journal, the mailbox.

  shop      the host on one machine. Runs N benches, owns their processes, ports, disk, budgets
            and leases. One shop per machine, exactly one supervisor per shop.

  mesh      shops on Tailscale, addressed by name. A bench on the laptop can ask a bench on the
            mini for a review, because both have a name and a mailbox.
```

```
                        ┌───────────── shop: macbook ─────────────┐
                        │  supervisor (launchd)                    │
   a scope ────────────▶│   ├─ bench dev-1575   [vise 3f2a… gen 4] │──┐
   (label/project)      │   ├─ bench jig-482    [vise 91be… gen 1] │  │  Tailscale
                        │   └─ bench spike-x    [paused, 0 cpu]    │  │  (WireGuard + MagicDNS)
                        └──────────────────────────────────────────┘  │
                                                                          │
                        ┌───────────── shop: mini ────────────────┐      │
                        │   ├─ bench review-queue  [vise …]       │◀─────┘
                        │   └─ bench forestbuilder [vise …]       │
                        └──────────────────────────────────────────┘
```

The bench is not a new idea. `docs/at-seam.md` §0.5 defines it: a scope gets a place, the place has
an agent that owns everything happening in the scope, and the place has a name other agents can
address. **This document is the machinery under that sentence.**

### The properties we are actually buying

| property                  | what it means                                                      | what it rules out                 |
| ------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| **durable for the scope** | the work outlives every session, restart and machine               | “my agent is a terminal tab”      |
| **self-contained**        | everything needed is _declared_, not discovered by trial and error | “clone it and hope”               |
| **handoff-safe**          | exactly one writer, fenced, and takeover is a bounded time         | “two agents, one branch”          |
| **cheap when idle**       | a paused bench costs disk and nothing else                         | “one machine per thread”          |
| **addressable**           | another agent can reach it by name and get a receipt               | “Slack message and hope”          |
| **one product**           | the run ends in one PR with its evidence                           | “a transcript of good intentions” |

---

## 1. The container, precisely

### 1.1 What is inside a bench

```
  bench/
    bench.json            the declaration: scope, kit, services, checks, ship policy, budgets
    worktree/             the repo at the scope's base commit (a git worktree, not a clone)
    home/                 the agent's home: config, caches, tool state, ~/.env
    journal/              pi-durable storage (sqlite): conversation, turns, tool calls, tasks
    outbox/               unsent mail, durable until the vise holder flushes it  (at-seam §6.5)
    desk/                 items waiting on a human, and their answers
    logs/                 process logs, check output, the shipped report
    lease.json            the vise: leaseId, generation, expiresAt, holder  (never authority)
    snapshot/             optional: the tar or the image this bench was restored from
```

Seven things have to survive a restart for the bench to be worth anything. They are also the
seven things every project in §2 gets right or wrong:

```
  1 conversation    the agent's context           → journal (pi-durable)
  2 workspace       committed AND uncommitted     → worktree + a checkpoint on ship
  3 software        installed tools and deps      → snapshot or content-addressed artifacts
  4 processes       dev server, watcher, db       → memory snapshot, or restart + resume hook
  5 credentials     secrets, tokens, ssh keys     → injected at start, never in the snapshot
  6 ports           what listens where            → a port lease per bench
  7 position        which item, which phase       → the desk + the journal, never the process
```

(7) is the one that makes it a _place_. (3) and (4) are the ones that make it expensive. (5) is the
one that gets people fired.

### 1.2 The durability ladder

Five rungs, cheapest first. Every project in §2 sits on one of them, and the rung decides what the
agent has to redo after a restart.

| rung                           | what survives                         | what is lost                          | start cost                     | who does it                                              |
| ------------------------------ | ------------------------------------- | ------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| **L0 worktree**                | files, git state, journal             | processes, installed software, caches | instant                        | us, v1                                                   |
| **L1 rootfs tar**              | files + installed software            | processes, open sockets, memory       | seconds                        | rexbox (on stop, not on sleep)                           |
| **L2 container image/disk**    | files + software + running containers | memory, terminals                     | 2s warm (rexbox), minutes cold | Docker, Apple `container`                                |
| **L3 VM with memory snapshot** | everything above + processes          | nothing but freshness                 | sub-second resume              | Amp-hosted orbs, Firecracker-class, agentOS on a VM host |
| **L4 machine**                 | everything, including hardware        | —                                     | power on                       | a real box per bench                                     |

Amp's own comparison table (self-hosted orbs) is the honest version of this and worth quoting:

```
  infrastructure      memory   disk   project snapshots
  ────────────────    ──────   ────   ─────────────────
  Amp-hosted orbs     yes      yes    yes
  Docker              no       yes    on one host
  Apple containers    no       yes    on one Mac, container 1.6.0+
  Kubernetes          no       yes    yes
  E2B / exe.dev       yes      yes    not in the example
  Modal / Vercel      no       yes    not in the example
```

So: **“memory survives” is the expensive property, and Docker cannot do it.** If we choose L0/L1
for v1, the cost is exactly one thing — services restart when a bench wakes — and that is why
`.agents/resume` exists and why it must fit in ten seconds.

### 1.3 Lifecycle

```
              ┌──────────┐  create   ┌──────────┐  setup (once)   ┌──────────┐
   scope ────▶│  absent  │──────────▶│ restoring│────────────────▶│  ready   │
              └──────────┘           └──────────┘                 └────┬─────┘
                                            │ snapshot hit            │ acquire vise
                                            └────────────────────────▶│
                                                                      ▼
              ┌──────────┐   idle 5m, no agent work     ┌────────────────┐
              │  paused  │◀─────────────────────────────│    working     │
              │ (0 cpu)  │──────── wake / mail ─────────▶│  (lease held) │
              └────┬─────┘                              └────────┬───────┘
                   │ archive                                     │ blocked on a human
                   ▼                                             ▼
              ┌──────────┐                                 ┌────────────┐
              │ archived │  delete when no longer needed    │   desk     │
              └──────────┘                                 └────────────┘
```

Four rules, copied from the two projects that got them right:

1. **Restoring happens before entry, not after.** rexbox restores the tar _before it allows ssh in_.
   Its reasoning is ours: a half-restored bench that accepts a prompt is a corruption event.
2. **`setup` prepares, `resume` repairs.** Amp's split is exact: `.agents/setup` runs once per
   snapshot and may install; `.agents/resume` runs on every wake, gets ten seconds, and must not
   install anything.
3. **The snapshot is keyed, not timestamped.** Amp invalidates on `(base commit, shared config,
   pre-clone script, pre-setup script)`. A timestamp key means every setup is a cold one.
4. **Pause is not delete.** Archiving keeps the disk. Deletion is a separate, explicit job —
   because a delete is the only irreversible thing a supervisor can do.

### 1.4 The declaration

`bench.json` is the container's whole contract, and it is committed so the bench is reproducible
by a stranger:

```jsonc
{
  "scope": { "kind": "github-label", "label": "dev-1575", "base": "develop" },
  "machine": { "provider": "worktree", "cpus": 2, "memoryMb": 4096 },
  "kit": { "setup": ".agents/setup", "resume": ".agents/resume" },
  "services": [
    { "name": "web", "command": "pnpm dev --port $PORT", "health": "/healthz", "port": 5173 },
  ],
  "checks": ["jig check", "pnpm test"],
  "ship": { "behavior": "branch", "restack": true },
  "budgets": { "tokensPerDay": 4000000, "usdPerDay": 40, "wallClockMinutes": 240 },
  "mesh": { "mailbox": "did:web:shop-a.tailnet.ts.net", "reviewers": ["did:key:z6Mk…"] },
}
```

The `services` block is Amp's `.amp/services.yaml` and rexbox's pane commands, unified: a service is
_something with a port and a health check that must come back on wake_. Everything else is a
command.

---

## 2. Deep dives

Six projects, each solving one layer. For each: what it is, what to take, what to leave, and where it
plugs into the bench.

### 2.1 Amp Orbs — the ergonomic contract

**What it is.** A thread gets a machine. The machine is snapshotted from `(base commit, shared
config, .agents/setup)`, resumed with `.agents/resume`, pauses 5 minutes after the agent stops
working and 20 minutes after your last interaction, costs nothing paused, and wakes with its disk
and (on Amp's own hosts) its memory intact. Sizes run 1 CPU/2 GB to 16/44 GB at $0.08–$2.13/hour,
billed by the minute. Plus: `.amp/services.yaml` for long-running services with portal links,
portals for previewing a dev server, OIDC workload identity (`amp orb id-token`, RS256, 10-minute
default, 60s–1h), automations (one schedule per thread), and agent-to-agent delegation.

**What to take — the ten rules.** These are the whole ergonomic payload and none of them need a
vendor:

1. one noun, six verbs: `new / up / status / shell / ship / pause`
2. zero-config start: infer the scope, write the config _after_
3. the repo declares its environment, and “prepare this repo for agents” is itself a prompt
4. snapshots are invisible; a new base commit silently invalidates one
5. pause is automatic and free
6. ship is a policy (`trunk | branch | custom`), not a script
7. the machine is one keystroke away
8. agents spawn agents with the same noun
9. secrets are temporary by default (OIDC, never a copied key)
10. one place to look: conversation, changes, services, checks, proof

**What to take — three mechanics.**

- **The snapshot key**, exactly as listed in §1.3.3, and the rule that setup must be safe to run
  twice because it _will_ run on top of an old snapshot.
- **Secrets: write `~/.env` at 0600 after the snapshot, remove it before taking one.** That single
  sentence is the difference between a bench that leaks keys into an image and one that does not.
  Note the leak Amp flags itself: anything your own setup script writes to disk _does_ enter the
  snapshot.
- **Idle is two clocks, not one**: no agent work for 5 minutes, no interaction for 20. A bench with
  a dev server running is not “busy”, so it can sleep — and a portal request wakes it, which is why
  portals feel alive without a keep-alive.

**What to take — autonomy.** Fan-out (N benches for N independent slices), side quests (a child
bench that reports back), explicit file transfer between benches (they do **not** share a workspace),
and “run on another project, orb, or machine” as the same operation. Our version is the mesh: a
child bench is just a bench with a parent link and a mailbox.

**What to leave.** The hosted product, the pricing, spawn pacing, the TUI/web surfaces, and the
belief that a snapshot needs a vendor. Also: do not copy Orbs' _word_.

**Where it plugs in.** `bench.json` (§1.4) is our `.agents/setup` + `.amp/services.yaml` + ship
policy in one file; the supervisor (§3) implements the pause/resume clocks; the mesh (§4) implements
agent-to-agent.

### 2.2 rexbox — the honest v1 implementation

**What it is.** Ubuntu 24.04 boxes in Docker on a Mac, or on Cloudflare. Each box is a container
with `sshd` and a Rex server, reached as `rexbox-NAME` on a **loopback** port with a key only rexbox
holds; panes are `ssh rexbox-NAME`. Home and `/work` persist until `rm`. `--mount` shows a Mac
folder at `/work`, `--ssh-agent` lets the box sign through the Mac's agent instead of copying keys.
Cloud boxes stop after **30 minutes with no connections**, save `home` and `/work` to R2, and
restore **before** the next connection. `new/ls/open/code/doctor` all take `--json`, and the docs
ship a `rexbox exec NAME -- CMD` for agents.

**What to take.** Almost all of it, at L1/L2:

- **tar two directories** (`home`, `work`) is the whole persistence story. Not a snapshot service.
- **restore before entry** — the single best sentence in any of these projects.
- **bind everything to 127.0.0.1.** Nothing in a box listens outside the Mac. Our bench ports are
  leases on loopback until the mesh says otherwise.
- **`--json` on every command** because agents are the real users.
- **`--ssh-agent`** instead of copying keys: a bench borrows a capability for the duration of a
  connection rather than holding a secret. Same idea as a signed pass.
- **idle stop + restore on connect** is the cheapest possible “scale to zero”.

**What to leave.** Docker as the mandatory substrate (it costs a VM on macOS), the Rex pane
coupling, and the assumption that a box is a place you ssh into — our bench is a place the _agent_
occupies and a human visits.

**Where it plugs in.** v1 machine provider: a container per bench, tar `home`+`work` on pause,
restore before the agent starts. v0 machine provider: skip Docker entirely and use a directory
(§3.3) — because the first thing we need is not isolation, it is durability.

### 2.3 agentOS — the API worth standardizing on

**What it is.** “A lightweight Linux-compatible VM runtime for isolated filesystem, process,
terminal, language, and networking workloads”, shipped as a fixed Rust actor with a generated
TypeScript contract, plus an embedded API for trusted Node apps. Durable filesystem roots
(`{ type: "durable", namespace: "root" }`), process run/exec, terminal, JS/TS/Python contexts, a
`network` surface (`fetch`, `fetchStream`, `connect`, `preview`), **cron**, and **software as
immutable `.aospkg` artifacts installed by HTTPS URL + sha256 digest**, cached process-wide by
digest. Hosted actors reject host mounts, host paths, callbacks — only serializable whitelisted
filesystem descriptors.

**What to take.** The _surface_, as our port interface, before we take the implementation: bench
operations are `filesystem`, `process`, `terminal`, `network.preview`, `software.install(digest)`,
`cron`. That set is complete enough to describe a bench and small enough to implement three ways
(directory, Docker, agentOS).

**What to take — two ideas that are better than ours.**

- **Software by digest, not by npm resolution.** A bench's tools are a manifest of digest-pinned
  artifacts. That is reproducible, cacheable across benches on one Mac, and auditable — and it is
  how a 2-second bench start is possible.
- **A permission policy that is a first-class object** (`configurePermissions`), not a pile of
  if-statements inside the agent loop.

**What to leave.** The VM ambition while the target is one Mac. A VM per bench on a laptop is
L3 richness at L4 cost.

**Where it plugs in.** §3.2's `BenchProvider` interface is deliberately shaped like agentOS's
groups, so that swapping in the actor later is a binding change.

### 2.4 herdr — how the shop knows _blocked_

**What it is.** “The runtime your coding agents live on.” A background Rust server owns terminals;
closing the client does not stop work; **every pane is marked working, blocked, or idle**; several
machines in one window with independent reconnects; and agents drive it through a CLI and socket
API — spawn panes, prompt each other, and **wait until another agent is genuinely blocked**. It runs
Claude Code, Codex, Cursor, OpenCode and the rest without wrapping them.

**What to take.** The observation surface, and the vocabulary. Any supervisor ends up needing
`working | blocked | idle | done | unknown`, and almost every one of them reimplements it badly by
parsing log tails. herdr already derives it from the process and the terminal. A shop should _ask
herdr_ rather than infer.

**What to take — the wait primitive.** “Wait until another agent is genuinely blocked” is the
primitive a parent bench needs to supervise a child: not “poll its status”, but “block until it needs
me”. pi-durable has the same shape for tasks (`waiting` policies); herdr has it for panes. Our
mailbox has it as `wakeReason`.

**What to leave.** Nothing structural. herdr is a dependency, not a competitor — a bench can _be_ a
herdr pane on the machines where a human wants to watch.

**Where it plugs in.** §3.5: the shop's status source is herdr when present, the journal when not.

### 2.5 pi-durable — the durability inside the container

**What it is.** A harness where conversations, turns, tool calls and tasks are **committed before
anything is shown**. If the process dies mid-turn, reopening the storage picks the work up; a model
request it died during counts as a failed attempt and is retried. `requestId` makes a submission
idempotent (`harness.submission(id)` reacquires it after a restart). Tasks are durable state
machines with a checkpoint per step; `runtime.sleepUntil(until)` stores the sleep so the task holds
no invocation meanwhile; `onWake` lets an evictable host (a Durable Object) arm an alarm instead of
a timer. Storage is SQLite, JSONL, IndexedDB, or a Durable Object; a second process can open a
conversation `readOnly` and know it must not write.

**What to take.** All of it, as the journal:

- **commit-before-show** is the property that makes “the agent can be killed” true instead of
  aspirational, and it is the same rule our mailbox needs for delivery (at-seam §6.5, D10).
- **`requestId` idempotency** is the pattern for every effect in the bench: submitting a turn,
  posting a review, sending mail, opening the PR. One key per intent, retry-safe.
- **`sleepUntil`** is how “wake me when CI finishes” becomes durable rather than a cron.
- **`readOnly` sessions** are how a shop lets you _watch_ a bench from another terminal without
  being a second writer — the exact distinction the vise exists to enforce.
- **`onWake`** is the interface our supervisor implements: tell the host the earliest deadline, let
  it wake you.

**What to leave.** Nothing. This is the substrate; do not rebuild it.

**Where it plugs in.** `journal/` (§1.1), the outbox queue (§4.4), and the "position" that survives
restarts (§1.1 item 7).

### 2.6 treadle — the loop that does the work

**What it is.** A long-lived loop bound to one repository, already in this workspace: one session at
a time, deterministic checks after every session (the agent never grades itself), a checkpoint
committed on the issue's branch at the end of every session whatever its terminal state, a receipt
per pass appended to the issue, per-session and per-day budgets, a rules→actions engine, a
HumanChannel, reconcile, and a maintenance loop for merging green PRs.

**What to take.** The loop discipline — that is the `DO` verb:

- **deterministic verification after every session**, which is jig's whole thesis applied to agent
  work; a bench that lets the agent decide it is done is not verifiable.
- **a checkpoint even on failure**, so recovery is “read the receipts”, not “read the transcript”.
- **budgets that persist per pass** and roll over at local midnight; a cap-stop is a state, not a
  typo.
- **a HumanChannel** as an interface (`askHuman`, `askWithOptions`, `close`) — which on a bench
  becomes a `desk.item` and a `desk.answer` record.

**What to leave.** The launchd-per-loop deployment when it runs under a shop (D8: one supervisor per
repo). Treadle becomes a **child process** the shop supervises; standalone mode keeps its plist.

**Where it plugs in.** §3.4. The bench supplies scope, vise, machine, mailbox and ship; treadle
supplies the loop.

### 2.7 Rat King / AT Protocol — pointer

One paragraph, because the protocol is its own document. The container needs exactly four borrowed
things from it: a **name** (`did:key` now, `did:web` later), a **lease** with a fencing generation, a
**mailbox** with `accepted → delivered → acked`, and a **desk** whose items are answerable records.
Error names, field names and idempotency keys come from his lexicons verbatim. See
`docs/at-seam.md`.

---

## 3. The shop: one Mac, many benches

### 3.1 Process model

```
  launchd
    └─ shopd                       one process per machine, owns nothing but the benches
         ├─ bench:dev-1575         supervisor loop + treadle child + services
         │    ├─ node pi-durable   the agent (inside the bench, not the shop)
         │    ├─ pnpm dev          a declared service, on a leased port
         │    └─ jig/treadle child the loop
         ├─ bench:jig-482
         └─ bench:spike-x          paused: no processes, only bench/ on disk
```

The rule that keeps this from becoming a distributed system by accident: **the shop owns
processes, the bench owns state, and nothing else owns anything.** A bench never daemonizes
anything the shop cannot see, or pausing becomes a lie.

Why one supervisor process and not one service per bench in launchd: because pause, port leases,
budgets and disk quotas are _machine-level_ decisions. Eight plists cannot make them together, and
launchd will happily restart a child that exited for the correct reason (lease loss) which is the
wrong behaviour — the same failure Amp guards with `keepAlive` leases.

### 3.2 The provider port

Everything that touches a machine goes through one interface. Three implementations, one contract:

```ts
export interface BenchProvider {
  readonly create: (spec: BenchSpec) => Effect.Effect<Bench, ProviderError>
  readonly restore: (bench: Bench) => Effect.Effect<Bench, ProviderError> // before entry
  readonly pause: (bench: Bench) => Effect.Effect<void, ProviderError> // checkpoint + stop
  readonly resume: (bench: Bench) => Effect.Effect<Bench, ProviderError> // then resume hook
  readonly exec: (bench: Bench, argv: readonly string[]) => Effect.Effect<Exec, ProviderError>
  readonly stream: (bench: Bench) => Stream.Stream<BenchEvent, ProviderError>
  readonly destroy: (bench: Bench) => Effect.Effect<void, ProviderError>
}
```

Amp's self-hosted-orbs _dispatch contract_ is the same shape with vendor names, and it is worth
copying the job vocabulary because it is already battle-tested:

| Amp dispatch job                      | our verb            | notes                                                 |
| ------------------------------------- | ------------------- | ----------------------------------------------------- |
| `spawn` (and `spawn` again to resume) | `create` / `resume` | a pause is resumed by the same job that created it    |
| `pause`                               | `pause`             | does not mean archived; do not delete on pause        |
| `delete`                              | `destroy`           | the only irreversible verb; requires an explicit step |
| `amp orb bootstrap` inside the orb    | `bench bootstrap`   | connects out, then the agent runs                     |

Two properties of their provider we should keep: **it is outbound-only** (Amp never dials in) and
**the dispatch program is a file you write, not an API you implement** (`amp orb provider
./dispatch.sh`). Ours: the shop dials its mailbox; nothing ever dials the shop.

### 3.3 Three providers, in order

| provider    | rung  | isolation       | what it proves                       | when                                   |
| ----------- | ----- | --------------- | ------------------------------------ | -------------------------------------- |
| `directory` | L0/L1 | none (same uid) | durability, lease, mail, ship        | v0 — build this first                  |
| `container` | L2    | uid + fs + net  | software survives, ports are real    | v1                                     |
| `agentos`   | L3    | full VM         | memory survives, artifacts by digest | v2, or when an untrusted repo shows up |

`directory` is not a toy. It is a worktree + a home + a journal + a tar. It gives durable-for-scope,
handoff, mail and one PR — the six properties in §0 — and it starts in milliseconds. The only thing
it cannot do is run untrusted code, which is why `container` exists and why `agentos` exists after
that.

```
  directory            container                agentos
  ─────────            ─────────                ───────
  worktree/            docker run --init        agentOS actor
  home/                -v home:/home/agent      durable fs root
  tar home work        docker commit? no → tar    snapshot in the VM
  port lease on 127.0.0.1  published port        network.preview
```

### 3.4 How many benches fit on one Mac

Assumptions, stated so they can be argued with: a bench at rest is a worktree (200 MB–2 GB) plus a
journal; a bench working is a Pi process (300–600 MB), a dev server (100–400 MB) and, during a
typecheck or test run, a 1–2 GB spike.

| provider   | active on 32 GB | paused (disk) | start      | memory kept |
| ---------- | --------------- | ------------- | ---------- | ----------- |
| directory  | 8–12            | 40+           | instant    | no          |
| container  | 4–6             | 40+           | 2s warm    | no          |
| agentos VM | 2–3             | 20+           | sub-second | yes         |

Disk is the real ceiling: 40 paused benches at 2 GB of home+work is 80 GB. So the shop needs a
**quota and an eviction policy** from day one (`paused > 14 days` → cold archive, never silent
delete).

### 3.5 Status without lying

Five states, and they must come from observation, not from what the agent _said_:

```
  working   a declared process is alive and its child session is running
  blocked   the agent is waiting on a desk item, a tool approval, or a check
  idle      alive, nothing running, no open item
  paused    no processes; state on disk
  unknown   the journal's last turn is older than the observation window — say so
```

Source of truth, in order: **herdr** (if the bench is a pane — it already derives
working/blocked/idle from the process and terminal) → **the journal** (a committed turn, a pending
task, a stored sleep) → **the process table** (last resort, and never render it as “idle”).

What makes this worth building carefully: “blocked” is the only state a human actually needs to be
interrupted for. Everything else can wait. A shop that cannot distinguish idle from blocked either
nags you or strands work, and both are why people stop trusting supervisors.

### 3.6 Budgets

Four budgets, all persisted per bench and per day, all enforced _before_ the spend:

```
  tokens      from the provider's usage per turn, summed in the journal
  dollars     tokens × the model's price, capped per bench per day
  wall clock  a max per run, then the bench pauses rather than runs away
  disk        a hard quota per bench; hitting it pauses the bench, never the machine
```

A cap-stop is a _state_ with a reason, rendered as `blocked: budget`, cleared at local midnight or
by an explicit `bench resume --with-budget`. Treadle already does exactly this for its loops;
reuse its numbers and its rollover rule instead of inventing a second accounting.

### 3.7 What actually breaks first on a Mac

Honest list, because a plan that ignores these is a plan for a demo:

| failure                        | why                                                                         | mitigation                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Docker Desktop is a VM         | one Linux VM for all containers; memory is shared and cannot be snapshotted | default to `directory`; use OrbStack/colima and accept L2                      |
| macOS sleep stops everything   | htop says 0 CPU, ports vanish, leases expire                                | release the vise on sleep (do not wait for expiry), resume at `generation + 1` |
| ports collide                  | 8 dev servers want 5173                                                     | a port lease per bench, recorded in `bench.json`, rendered in `bench status`   |
| file watchers                  | hundreds of worktrees × watchers exhaust fd/inotify                         | one watcher per bench, capped; never watch `node_modules`                      |
| Spotlight and Time Machine     | index and back up 80 GB of worktrees                                        | exclude the shop root in both, and say so in the docs                          |
| uncommitted work lost on pause | `git` does not save it for you                                              | checkpoint before pause: commit to `bench/<scope>` or a stash ref, always      |
| keychain prompts               | a background process touching secrets blocks on a dialog                    | inject secrets as env at start; never read the keychain on wake                |

---

## 4. The mesh: Tailscale

### 4.1 Topology

```
   ┌──────────────┐        ┌──────────────┐        ┌──────────────┐     ┌──────────┐
   │ macbook      │        │ mini         │        │ vps (linux)  │     │ phone    │
   │ shop         │◀──────▶│ shop         │◀──────▶│ shop         │     │ viewer   │
   │ 3 benches    │  mesh  │ 4 benches    │  mesh  │ 10 benches   │     │ only     │
   └──────────────┘        └──────────────┘        └──────────────┘     └──────────┘
          │                      │                       │
          └──────────────────────┴───────────────────────┘
                    Tailscale: WireGuard, MagicDNS, ACLs
```

**One shop per machine is one Tailscale node.** Benches are _not_ nodes. This is the decision that
keeps the mesh legible: 40 benches would otherwise be 40 nodes, 40 ACL entries, 40 DNS names, and a
Tailscale admin console nobody can read.

### 4.2 Addressing

```
  shop      did:web:shop-a.tail3040.ts.net          (or did:key locally, did:web when it's public)
  bench     did:web:shop-a.tail3040.ts.net:bench:dev-1575   ← a name, per the protocol
  mailbox   https://shop-a.tail3040.ts.net/xrpc/dev.autotelic.mailbox.send
  blob      https://shop-a.tail3040.ts.net/xrpc/dev.autotelic.blob.get?cid=bafy…
```

The shop terminates and _routes_. A bench's identity is a name the shop hosts, exactly like a chat
server hosting mailboxes. A bench never listens; the shop does. This is why a paused bench can still
receive mail — the shop accepts it, and delivery happens when the bench resumes (at-seam D10).

### 4.3 What crosses a machine boundary

| what             | transport                | retry                                           | authorization                                                |
| ---------------- | ------------------------ | ----------------------------------------------- | ------------------------------------------------------------ |
| a review request | mailbox `send`           | idempotent on `(senderDid, TID)`; retry forever | sender's lease fence                                         |
| an answer        | `desk.answer` (a record) | idempotent on the record key                    | the desk's ACL                                               |
| a sealed report  | blob by CID              | content-addressed, so any transport works       | the record that cites it                                     |
| a lease          | never crosses            | —                                               | leases are per-name, and a name is hosted by one shop        |
| a workspace      | never crosses            | —                                               | benches do not share a worktree; they send files or a commit |

That last row is the discipline Amp states plainly: “a message does not transfer files or commits
by itself”. A bench that needs a file gets it as a blob or a git ref, never as an implicit side
effect of a message.

### 4.4 The laptop problem, and the outbox

A bench on a laptop cannot hold the vise while the lid is closed. So:

```
  lid open    acquire 60s lease, renew at 20s
  sleep       release the vise (do NOT wait for the clamp) → takeover is immediate, not delayed
  wake        acquire at generation + 1, reconcile the journal against the mailbox watermark,
              flush the outbox with the new fence
  offline     mail is committed to outbox/ locally; a send is a queue write, not an RPC
```

This is why the outbox is a **store, not a lexicon** (at-seam §6.5): durability of an intent is our
implementation detail; the intent itself is his `mailbox.send`.

### 4.5 Trust is the signature, not the network

Tailscale is a convenience and a blast radius, not a security boundary:

- **Identity is the DID and its key**, so a mail from `did:key:z6Mk…` verifies on any transport,
  including a piece of paper. Moving a shop to a new tailnet must not change who it is.
- **ACLs limit who can reach a shop at all** — `tag:shop` may reach `tag:shop`, `tag:phone` may reach
  only `/view/*` — which is about reducing accidental exposure, not about authorization.
- **No shared secrets.** Each shop mints its own key. A worker gets a signed pass with a scope and
  an expiry, never a copy of the key (at-seam §1, `sh.ratking.pass`).
- **Outbound-first.** Wherever possible the shop dials out (to a mailbox, to GitHub) and nothing
  dials in; the mesh is then only needed for peer reads.

### 4.6 Alternatives, and why not

| option                     | appeal                                                                   | why not                                                                                    |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| raw WireGuard              | no dependency                                                            | no DNS, no ACLs, no NAT traversal, no mobile clients — we would build Tailscale            |
| SSH only                   | already installed                                                        | no addressing model, no streaming, no authz for _which_ verbs; becomes a command allowlist |
| Cloudflare Tunnel + Access | public URLs, SSO                                                         | puts a vendor in the path of peer-to-peer mail; fine for a viewer, wrong for the mesh      |
| cloud relay                | works when both sides sleep                                              | a hosted service holding our mail, which is exactly what federating avoids                 |
| Tailscale                  | identity per node, MagicDNS, ACLs, no inbound ports, tsnet for embedding | costs one dependency                                                                       |

Chosen: **Tailscale for reachability, DIDs for identity.** If Tailscale disappeared tomorrow, the
mail format and keys still work over SSH or a file on a USB stick.

---

## 5. Moving a bench between machines

The property that makes the fleet possible, and the one pi-durable gives us for free: **a bench's
position is in its storage, not in its process.**

```
  a session is (conversation, task graph, pending submissions, spend, documents)
  pi-durable persists all of it: every turn committed before it is shown, every task checkpointed
  per step, every submission keyed by requestId, every sleep stored with a deadline

  therefore:  storage + worktree + outbox + desk + bench.json  ==  the whole bench
              processes, ports, memory, leases                       ==  the host's problem
```

The user-visible consequence: `bench move mini` is a normal operation, not a migration event. The
name does not change, the journal does not fork, and a review request that arrives while the move is
in flight is delivered when the bench lands.

### 5.1 The move protocol

```
  1 quiesce      stop services; drain the loop to a checkpoint; close the harness
  2 release      release the vise explicitly (do not wait for the clamp)  ← takeover is immediate
  3 seal         hash what moves: journal, worktree (incl. uncommitted), outbox, desk, bench.json
  4 copy         rsync/tar to the target shop; verify every hash before anything starts
  5 acquire      target shop acquires the name's lease at generation + 1
  6 restore      restore-before-entry, run .agents/resume (≤10s), reconcile the mailbox watermark
```

Four rules that are not optional:

1. **Copy after quiesce, never during.** SQLite with a live writer copies into a corrupt database,
   and pi-durable says so itself: a writable JSONL open repairs files the writer may be appending
   to. So the writer closes before the bytes move, and `readOnly` is for watching, not for moving.
2. **The lease is never copied.** It is released and re-acquired; the new generation is the proof
   that the old host is fenced out. A bench that arrives with a lease file from elsewhere is a
   security bug, not a convenience.
3. **Secrets do not travel.** Re-injected at start from the shop's own store or an OIDC exchange.
   A moved bench that carried `~/.env` in its tar has published the key to the network.
4. **A fork is quarantined, not merged.** The fence stops the _effects_ of a stale writer; it cannot
   stop two copies of the _data_ existing. If both shops believe they hold the bench, the losing
   copy is moved to `quarantine/<name>-<generation>` and a human decides. Silent merges of two
   journals is how a transcript becomes fiction.

### 5.2 The continuation token

What actually crosses the network is a small, checkable descriptor — not a machine image:

```jsonc
{
  "name": "did:web:mini.tail3040.ts.net:bench:dev-1575",
  "seq": 148, // mailbox watermark: everything ≤ seq is delivered/acked
  "journal": { "sha256": "…", "bytes": 4194304 },
  "worktree": { "ref": "refs/bench/dev-1575", "dirty": "sha256:…" },
  "outbox": { "pending": 2, "sha256": "…" },
  "lease": { "generation": 6, "releasedAt": "…" },
  "from": "macbook",
  "to": "mini",
}
```

That descriptor is also what `bench status --json` reports, which is why “is this bench healthy” and
“can this bench move” are the same question.

### 5.3 Storage choice, because it decides how movable a bench is

| storage          | move cost                              | risk                                                     | verdict                                                   |
| ---------------- | -------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| SQLite per bench | one file + WAL, copy after quiesce     | WAL left behind → looks like data loss                   | **default**: smallest, fastest, one writer                |
| JSONL directory  | rsync-friendly, per-conversation files | a writable open repairs files; concurrent copies diverge | use when a bench must move often, or be readable over NFS |
| Durable Object   | no move at all (it wakes on demand)    | it is a Cloudflare deployment                            | the L3 future, not v1                                     |

A corollary worth stating: **a bench that can move is a bench that can be backed up.** The same six
steps with `to: cold-storage` are the disaster plan, and `bench move` failing its hash check is
how we find out the backup was wrong.

---

## 6. The portfolio: many repos, one organization

The fleet is not “one bench per problem”. It is **every repo we work on, each with a place, all
addressable from any machine.** That is what the tailnet is for: not remote access, but
parallelism — the same agent runtime pointed at every repo at once, coordinating where they
overlap.

### 6.1 Three levels of scope, one noun

```
  org       Autotelic                      a place with no repo: mail, desk, records
    ├─ repo-set   “checkout v2”             a Linear project spanning repos
    │    ├─ bench  acme/web      label dev-1575
    │    └─ bench  acme/ui       label dev-1575
    └─ repo-set   “jig 0.4”
         ├─ bench  autotelic/tackle  label jig-482
         └─ bench  autotelic/cutlist label jig-482
```

One rule keeps this from exploding: **one bench = one `(repo, scope)`.** A parent scope is a
`work.scope` record that names children by at-uri, and spawns them. That is Amp's fan-out and its
“spaces without a project” with one noun instead of three, and it is why a Linear project that spans
repos does not need a special object.

### 6.2 The binding constraint is work in progress, not CPU

Forty paused benches cost disk. Twelve active benches cost **attention**: twelve PRs to review,
twelve sets of checks to read, twelve agents that can each be wrong in a new way. So the shop
enforces WIP, not parallelism:

```
  per bench      one live run at a time            (treadle already does this)
  per repo       one active bench per scope         (a second one waits, paused, at zero cost)
  per shop       N active (8–12 on a 32 GB Mac)     (the rest queued or paused)
  per org        a queue of scopes, ordered by the label that pays for them
```

`bench queue` is therefore a first-class verb, and it is more important than `bench new`: the
portfolio's health is “what is waiting and why”, not “how many can we start”.

### 6.3 The shared package: a worked example

This is the case that motivates the whole section. Six repos depend on `@autotelic/x`. A change to
`x` is not six changes; it is one release train, coordinated by mail and made visible by records:

```
  bench: autotelic/x            (the parent)
     │  ship @autotelic/x@0.5.0  → work.ship + package.release record
     ▼
  ┌─ mail: “x 0.5.0 is out; adopt or tell me why not” ─────────────────────┐
  │                                                                        │
  ▼                    ▼                    ▼                    ▼          ▼
 bench: acme/web    bench: acme/ui     bench: tackle     bench: cutlist   bench: forest
   bump dep           bump dep          bump dep          bump dep         bump dep
   jig check          jig check         pnpm test         pnpm test        jig check
   ship               ship              ship              ship             ship
     └────────────────────┴────────────────────┴───────────────┴──────────────┘
                    each replies with repo.pin { package: x, version: 0.5.0, sha }
                                        │
                                        ▼
                        adoption snapshot: “5 of 6 on 0.5.0”
```

Four things make that work, and three of them already exist in this document:

1. **A child bench per consumer.** Not a monorepo: each consumer has its own worktree, checks, and
   ship policy, and its own agent — so `acme/ui`'s bump is verified by `acme/ui`'s tooling.
2. **Mail, not a broadcast channel.** The parent sends one mail per consumer with a `wakeReason`, and
   gets one answer per consumer. Unanswered is a _state_, not a silence.
3. **A pin record per repo.** `dev.autotelic.repo.pin { package, version, sha, at }`. The repo owns
   its pin; nobody central approves a commit.
4. **An adoption snapshot for the org.** The same record shape as `rule.adoption` (at-seam D7):
   counts, no paths. “5 of 6 on 0.5.0” is a query over pins, and it is the only number the org
   needs to see.

And one rule that keeps the train from derailing: **the parent never edits a child's code.** It
publishes and asks. A cross-repo change that requires an edit inside a consumer is a _different_
bench in that consumer's repo, with its own review — otherwise the org bench becomes a monorepo
with extra steps.

### 6.4 The org bench

The one bench that never pauses. It holds no repo and runs no agent loop; it holds the org's name,
mailbox, desk, and records:

```
  did:web:autotelic.dev          ← the org identity
    work.scope      one per repo, forever     (“which places exist”)
    repo.pin        one per repo × package    (“who is on what”)
    package.release one per published version
    rule.adoption   periodic counts
    desk            the human queue: “jig 0.4 is blocked on review”
```

It is the only always-on service in the fleet, it lives on the VPS (or a home box), and it holds no
code. Everything else can sleep, including every machine you own.

### 6.5 The five coordination patterns

Once benches can address each other, almost all multi-repo work is one of five shapes. Naming them
prevents inventing a sixth:

| pattern           | shape                                               | example                          | cost control                      |
| ----------------- | --------------------------------------------------- | -------------------------------- | --------------------------------- |
| **fan-out**       | one parent, N children, same task                   | test four screen sizes           | child budget caps                 |
| **side quest**    | one child, independent result, parent keeps working | “find the bug in the old branch” | one child, one report             |
| **release train** | one parent publishes, N children adopt              | the shared package above         | WIP per repo                      |
| **review queue**  | N benches request, one reviewer answers             | the review desk                  | attention policy                  |
| **incident**      | one bench owns, N benches are told to freeze        | a bad publish                    | a mail with `wakeReason: “quiet”` |

Each is a mail topology, not a scheduler feature. The shop schedules processes; the _portfolio_
schedules scopes, and that is a desk, not a cron.

## 7. Services: build, adopt, never

### 7.1 Build — we own the contract

| service         | why we own it                                             | smallest real version                                    |
| --------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `shopd`         | the only thing that can pause, lease and budget a machine | 600 lines: scan, spawn, renew, pause, reconcile          |
| `bench`         | the container's verbs are our ergonomics                  | `new/up/status/say/ship/pause` over `bench.json`         |
| mailbox host    | it is the seam's server half; his app is a DO deployment  | SQLite + 5 XRPC paths + fence + idempotency              |
| journal adapter | pi-durable is the engine, we own where it lives           | open SQLite in `journal/`, one writer                    |
| checks runner   | deterministic verification is the product                 | run `bench.json` checks, write a report, gate `ship`     |
| ship            | one PR with evidence is the deliverable                   | branch + rebase + checks + one PR + a `work.ship` record |
| desk            | the human interface to a blocked bench                    | `bench inbox`, answer in place, record the answer        |

### 7.2 Adopt — do not rebuild

| we would build               | use instead                  | because                                                                          |
| ---------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| an agent loop with tools     | **pi**                       | it exists, and it is where the harness's quality lives                           |
| a durable journal            | **pi-durable**               | commit-before-show, `requestId`, tasks, `sleepUntil`, `onWake`                   |
| pane/agent state             | **herdr**                    | working/blocked/idle derived from the process, plus a socket and wait primitives |
| a work loop with budgets     | **treadle**                  | sessions, deterministic checks, checkpoints, receipts, rules                     |
| a VPN                        | **Tailscale**                | WireGuard + MagicDNS + ACLs + no inbound ports                                   |
| branches and worktrees       | **git**                      | `git worktree` is a bench machine with perfect deduplication                     |
| a wire format                | **AT lexicons**              | names, records, fence, idempotency, errors — already specified                   |
| conformance to our own rules | **plumb/joggle/cutlist/jig** | the tools in this repo, on the tools in this repo                                |

### 7.3 Never build

| tempting service                 | why not                                                           | what to do instead                                                                  |
| -------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **a PDS**                        | hosting signed repos is a lifetime of protocol work               | `did:key` + a mailbox; a PDS when a third party needs to verify our records offline |
| **a relay / AppView / feed**     | someone must run it, and it holds everyone's defects              | publish verdicts + adoption counts, opt-in (at-seam D2/D7)                          |
| **an auth system**               | keys, sessions, passwords, recovery — all of it is a product      | DIDs; signed passes for workers; Tailscale for reachability                         |
| **a VPN**                        | see above                                                         | Tailscale                                                                           |
| **a container runtime**          | cgroups, namespaces, rootfs, networking, snapshots                | `directory` provider, then Docker, then agentOS                                     |
| **an orchestrator-as-a-service** | scheduling, placement, health, rolling deploys                    | one `shopd` per machine, one supervisor per repo                                    |
| **a second vocabulary**          | `bench` in an NSID, `vise` in a record → two names for one object | D3: wire words are his; local words never leave the CLI                             |
| **a metrics stack**              | Prometheus + dashboards for 10 benches                            | the journal and `bench status --json`                                               |
| **a UI before a CLI**            | the UI becomes the only client and the CLI rots                   | CLI + `--json` first; the TUI reads the same JSON                                   |
| **a scheduler/cron service**     | distributed cron is a trap                                        | `sleepUntil` in the journal; the shop's alarm                                       |
| **a message queue**              | retries, dead letters, ordering, ops                              | `outbox/` + a mailbox with `seq` and receipts                                       |
| **a snapshot service**           | dedupe, compression, GC, consistency                              | tar of two directories, keyed by content                                            |

### 7.4 The seam table

Every one of those is a port with one real implementation and a written contract:

```
  port                 v0 (this week)        v1                    contract owner
  ─────────────────    ──────────────────    ──────────────────    ─────────────────────
  BenchProvider        directory + tar       docker + tar          us, shaped like agentOS
  Journal              pi-durable sqlite     same                  pi-durable
  Mailbox               loopback service      tailnet service       at-seam lexicons
  Observation          journal + ps          herdr socket          us
  Checks               bench.json + jig      same                  jig/protocol
  Ship                 git branch + gh       same                  us + work.ship
  Identity             did:key               + did:web per shop    AT
```

---

## 8. Work plan

Each milestone is one PR-shaped change, has a falsifiable acceptance test, and deliberately does
_not_ do the thing after it. M0 is already specified in `docs/at-seam.md` §7.

### M0 — the protocol, offline

**Build:** `protocol` 0a (NSIDs, `probabilityBp`, `x-strict`, delete the legacy `protocolVersion`
branch) and `fixtures/v0` for the mailbox (happy paths + the ten refusals).
**Done when:** `pnpm check` is green, the fixtures decode, and no schema has an `anyOf`.
**Test:** a fixture that a permissive host would accept and a correct host must refuse (e.g. `ack`
before `deliver`) exists and is named.
**Unblocks:** M3's host can be written against bytes instead of prose.

### M1 — one bench, durable, no mail

**Build:** `shopd` scan + `bench new/up/status/pause/resume`; `directory` provider; pi-durable
journal; `bench.json`; the pause clock; port leases.
**Done when:** kill -9 the bench mid-turn, `bench up` resumes from the last committed turn, and two
pauses leave exactly one worktree and one tar.
**Test:** `bench status --json` reports `paused` after the idle window with zero child processes, and
`resumed` afterwards with the same journal hash.
**Deliberately absent:** mail, desk, treadle, docker.

### M2 — the loop, and the machine's limits

**Build:** treadle as a supervised child (`--config` from `bench.json`); budgets with cap-stop; the
five status states; `bench logs`.
**Done when:** a bench works an issue from the tracker, runs deterministic checks, checkpoints on
failure, and stops on budget with `blocked: budget`.
**Test:** set `usdPerDay` to a number the loop exceeds in ten minutes; after the stop, `resume
--with-budget` continues from the receipt.
**Deliberately absent:** a second bench on the same Mac — that is M2b if it drifts.

### M3 — two benches, one mailbox, one Mac

**Build:** the mailbox host on loopback (send/list/deliver/ack/lease, fence, idempotency, his error
names); `bench inbox`; the outbox; `desk.item`/`desk.answer` over CLI.
**Done when:** bench A asks bench B for a review, B answers, A's desk shows the answer as a record,
and a replay of the send produces no second message.
**Test:** kill the host mid-send; restart; the send is retried and the recipient sees one message.
**Deliberately absent:** Tailscale. Both benches are on one Mac.

### M4 — the mesh

**Build:** a shop endpoint on `tailscale serve`; `did:web` per shop; ACLs (`tag:shop` ↔ `tag:shop`,
phone read-only); blob fetch by CID.
**Done when:** a bench on the laptop asks a bench on the mini for a review over the tailnet, and the
laptop is closed for part of it.
**Test:** close the lid during the round trip. On wake, the request is flushed from the outbox with a
new generation, and the answer arrives without a duplicate.
**Deliberately absent:** more than two machines.

### M5 — ship

**Build:** `bench ship` (diff → checks → rebase → branch → one PR → `work.ship` record with check
strongRefs); the restack option; the refusal path.
**Done when:** a bench with two new findings **refuses** to ship and shows them; after they are
accepted (an `acceptance` event), the same command opens exactly one PR citing the evidence.
**Test:** run `bench ship` twice; the second run updates the same PR, and the marker in the PR body
is identical.
**Deliberately absent:** merge. The bench never merges.

### M6 — L1 and the second machine

**Build:** `container` provider (docker + tar), the snapshot key, `bench snapshot status`, shop
registration and a second shop in the mesh.
**Done when:** a bench that installed dependencies pauses, moves to the other machine's shop, and
resumes without running `setup` again.
**Test:** change the base commit; the next bench start runs `setup` (key invalidated) and the one
after that does not.

---

## 9. Risks, ranked

| risk                              | first symptom                      | cheap test now                      | mitigation                                              |
| --------------------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| pause loses uncommitted work      | “my patch is gone”                 | pause mid-edit, resume              | checkpoint commit before pause, always                  |
| two writers on one repo           | duplicate PRs, phantom reviews     | start two benches on one scope      | the vise, and `acquire` never steals                    |
| mail is not durable               | a request vanishes on restart      | kill the host mid-send              | outbox + `(senderDid, TID)` idempotency                 |
| the agent loop is not durable     | a crash costs a whole run          | kill -9 mid-turn                    | pi-durable, commit-before-show                          |
| disk fills silently               | the Mac “gets slow” then full      | 40 paused benches on a 512 GB disk  | quota + eviction + a visible number in `status`         |
| secrets in a snapshot             | a key in an image                  | grep the tar for a canary           | write `~/.env` after snapshot, delete before            |
| docker is a VM                    | memory pressure across benches     | three dev servers                   | default `directory`, document the trade                 |
| Tailscale ACL drift               | a bench reaches what it should not | `tailscale ping` + a denied request | ACLs in version control, reviewed with the repo         |
| the protocol drifts from the host | two vocabularies again             | fixtures decode in both             | M0's fixtures gate both sides                           |
| we build a platform               | no shipped PRs for a month         | the milestone list                  | any milestone that needs a service not in §7.1 is wrong |

---

## 10. Words

Woodworking, and the rule from D3: **a word that appears on the wire is not ours to choose.**

| word        | what it is                                                 | appears on the wire?       |
| ----------- | ---------------------------------------------------------- | -------------------------- |
| **shop**    | one host process per machine                               | no                         |
| **bench**   | one durable container for one scope                        | no (records say `work.*`)  |
| **vise**    | the lease that gives exactly one writer the right to act   | no (`runtime.lease`)       |
| **room**    | the conversation inside a bench                            | no (the journal)           |
| **desk**    | what waits on a human, answerable in place                 | yes — his word, his record |
| **mailbox** | how benches reach each other                               | yes                        |
| **jig**     | the tool that holds a piece for one operation (the checks) | no                         |
| **board**   | the material: records                                      | no                         |
| **kit**     | the declared environment: setup, resume, services          | no                         |
| **mesh**    | the tailnet of shops                                       | no                         |

A `bench status --json` therefore emits `leaseId` and `generation`, never `vise`. The CLI may say
“vise held by 01a1fa5b”; the JSON may not.

---

## 11. What we would regret skipping

Six things, each cheap now and expensive later:

1. **`requestId` on every effect.** Submit a turn, request a review, send mail, open a PR, answer a
   desk item. Retry-safety is not an optimization; it is the difference between a durable bench and a
   guessing one.
2. **The snapshot key** `(base commit, config, setup hash)`. A timestamp key turns every start into
   a setup, and setup is where the minutes go.
3. **Secrets after the snapshot, deleted before it.** One canary test in CI catches the regression
   forever.
4. **His error names, verbatim.** The error name _is_ the client's retry policy.
5. **One supervisor per repo.** Two supervisors is two owners, and the fence exists to make that
   impossible.
6. **Release the vise on sleep.** Waiting for expiry turns a 60-second takeover into a five-minute
   one, and “my laptop was asleep” becomes “the bench is stuck”.

---

## 12. Open questions worth answering before M3

- Does a bench hold _one_ scope or can a scope span repos? (Amp's Spaces span a project; treadle is
  repo-scoped. Our answer: one bench = one `(repo, scope)`, and a parent scope record spawns child
  benches — the same noun spawning itself.)
- Who answers a desk item when nobody is watching? Today: nobody, and the bench pauses. That is
  correct and should stay correct until there is an attention policy (`attention.status`) to consult.
- Does the shop expose a _read-only_ HTTP surface for a phone, or only mail? (A viewer is cheap and
  is not on the wire.)
- Which store is the mail of record when a shop is offline: the shop's SQLite, or a third box? Start
  with the shop; a bench's outbox makes the `N=1` case honest.
- Do we run one shop per _user_ or one per _machine_? Per machine, because pause and ports are
  machine facts; a user with two machines has two shops and one identity.
