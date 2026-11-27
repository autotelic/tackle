# The technology seams

Written at `83241688` (2026-11-26), after reading the source, the pins, and the installed type
definitions. One section per adopted technology: what we call, what we lean on, what we are not
using, and every place we reimplement or duplicate its concern. Then a ranked backlog of concrete
cuts, each with an owner, the API to call instead, and the test that proves it.

Nothing here is a cut. This document is the map; the cuts are separate passes.

## Method and citation convention

Citations are `file:line` at this HEAD. Dependency line numbers are into the installed
declarations, not into prose: `agentos-core@0.4.9 dist/agent-os.d.ts:545` is the `process.list`
member of that exact version. Where the worktree has no `node_modules`, the declaration was read
from the same version resolved in the sibling checkout
(`node_modules/.pnpm/@rivet-dev+agentos-core@0.4.9/...`), because the pin is identical
(`packages/room/package.json:38`).

The counts in the Effect section are from this HEAD:

```sh
grep -rn "Date.now(" packages/board/src packages/room/src | wc -l                        # 23
grep -rn "console\.\(log\|error\|warn\)" packages/board/src packages/room/src | wc -l  # 125
grep -rn "throw new" packages/board/src packages/room/src | wc -l                        # 64
```

## The inventory

| Technology    | Identity here                                                                             | Owning packages           |
| ------------- | ----------------------------------------------------------------------------------------- | ------------------------- |
| Effect        | `catalog: 4.1.5` (`pnpm-workspace.yaml:27`, overrides `:93`)                              | every package             |
| Alchemy       | `2.0.0-beta.87` direct pin (`packages/board/package.json:42`)                             | board, room               |
| agentOS       | `@rivet-dev/agentos-core 0.4.9` (`packages/room/package.json:38`)                         | room                      |
| Rat King / AT | no package; fixture pin `9c49c10b843f8ee5626a5511aa2f28949767c994` (`docs/cutover.md:23`) | protocol, board, room     |
| Treadle       | workspace `@autotelic/treadle 0.1.0`; pi SDK 1.5.0 (`packages/treadle/package.json`)      | treadle                   |
| Executor      | not installed; evaluated at `f2582c5` (`docs/executor.md:3`)                              | board (borrowed shape)    |
| Effect UI     | `https://pkg.pr.new/Effect-TS/ui/@effect/ui@87a704b` (`pnpm-workspace.yaml:44`)           | board/view, cutlist       |
| Herdr         | no package; `herdr-app` control CLI and `hc` terminal CLI                                 | board, herdr/factory      |
| Tailscale     | no package; `tailscale status --json` CLI                                                 | board                     |
| SQLite        | `node:sqlite` at Node >= 24.18 (`package.json` engines)                                   | board, room (via agentOS) |

---

## 1. Effect — `catalog: 4.1.5`

**Pin.** One catalog line (`pnpm-workspace.yaml:27`), one override block (`:93`), enforced by
`pnpm check:catalog` (`scripts/check-catalog.mjs`, the `WATCHED` list). The house rule is exact
pins, never a caret, because two Effect identities in one program cannot talk.

**What we call.**

| API                                                               | Sites                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Schema`                                                          | `packages/board/src/factory/store.ts:7`, `events.ts:5`, `executor.ts:4`, `packages/room/src/store.ts:2`                                                                                                            |
| `Data.TaggedError`                                                | `factory/desk.ts:41`, `store.ts:106`, `events.ts:20`, `adopt.ts:18`, `candidate.ts:123`, `candidate-environments.ts:60`, `daemon.ts:13`, `mailbox/service.ts:80`, `mailbox/did.ts:9`, `room/src/Mailbox/cli.ts:15` |
| `Result`                                                          | `factory/kernel.ts:10` and nearly every factory module; `tailnet.ts:6`                                                                                                                                             |
| `Option`, `Predicate`                                             | `preview.ts:3`, `tailnet.ts:5`, `executor.ts:3`, `bind.ts:2`                                                                                                                                                       |
| runtime (`Effect.gen`, `Scope`, `Fiber`, `Queue`, `Ref`, `Clock`) | `packages/board/src/Supervisor.ts:1`; `supervise` at `:65`                                                                                                                                                         |
| `Effect.tryPromise`, `acquireUseRelease`                          | `packages/room/src/AgentOs.ts:41`, `:115`                                                                                                                                                                          |
| `Effect.runPromise`                                               | `packages/room/src/cli.ts:126`, `:139`, `vm-supervise.ts:111`                                                                                                                                                      |
| `@effect/vitest`, `@effect/platform-node`                         | devDependencies of every package; runtime adapters in the CLIs                                                                                                                                                     |

**What we rely on it for.** Boundary decoding (`Schema.decodeResult` on every committed JSON
file), typed refusals, and the one real supervision tree (board's `Supervisor`, Effect fibers with
a restart budget).

**What we are not using, and where it would replace local code.**

- **`Logger`.** 125 `console.*` calls across board and room. The factory writes receipts and
  logs; a `Logger` layer would give one place to route them and one place to redact a secret that
  escaped the executor.
- **`Clock`.** 23 `Date.now(` calls: `ready.ts:127`, `daemon.ts:54`, `cli.ts:1149`. Room already
  threads `at` through its store (`room/src/store.ts:103` passes `now` into the aggregate). The
  factory does not; it reads the wall clock inside the decision.
- **`Data.TaggedError` + `Effect.catchTag`.** Seven classes keep a `_tag` field but extend
  `Error`: `Supervisor.ts:44`, `executor.ts:76`, `AgentOs.ts:14`, `Worktree.ts:25`,
  `Mailbox/log.ts:34`, `ExecutorLease.ts:16`, `room/store.ts:57`. They are tagged by convention,
  not by the type system, so a new caller cannot `catchTag` them.
- **`Context.Tag` + `Layer`.** `Supervisor` is a function returning a handle; rooms and the board
  construct services directly. The house style names this as the target.
- **`Schedule`.** The daemon's poll loop is a `setTimeout` recursion; retries are ad hoc.

**Where we duplicate.** The target is already written down in the kernel, as a refusal message
(`packages/board/src/factory/kernel.ts:499`): "typed failures use Data.TaggedError and
Effect.catchTag; time uses Clock; logging uses Logger; boundary validation uses Schema.decodeUnknown;
services use Context.Tag + Layer; retries/limits use Schedule… The receipt counts
bespokeErrorUnion, throwCount, dateNow, and consoleLog before and after." That paragraph is the
spec for cut 10.

**Verdict.** Effect is genuinely the runtime, not a wrapper. The residual is the factory's plain
async pass loop and the untagged error classes.

---

## 2. Alchemy — `2.0.0-beta.87`

**Pin.** Direct in board (`packages/board/package.json:42`, with `@alchemy.run/cloudflare` and
`@alchemy.run/domain`) and in room (`packages/room/package.json:35`). It is not on the catalog
watch list; only Effect, TypeScript, and the Oxc toolchain are (`scripts/check-catalog.mjs`).

**What we call.**

- The Domain model for rooms: `Room` aggregate (`packages/room/src/Room/Room.aggregate.ts:37`),
  `RoomModel` (`Room/Room.model.ts:7`), `Move` aggregate (`Move/Move.aggregate.ts:28`),
  `MoveModel` (`Move/Move.model.ts:5`), and every command, event, rejection, view, and API under
  those two directories.
- The store asks the aggregate rather than re-deciding: `packages/room/src/store.ts:103` calls
  `Room.predict(state, command, …)`; the comment states the rule ("the store never re-implements
  it").
- The Cloudflare hosting layer: `packages/board/src/RoomDurableObjects.ts:8`,
  `DomainCloudflare.layerDurableObjects()`.

**What we rely on it for.** One state machine for room lifecycle, with predict/decide typing and
two hostings (in-memory for stories, Durable Objects for production). `Domain.Model` also owns
aggregates, views, policies, projections, streams, sagas, and queries (`dist/lib/Model.d.ts`).

**What we are not using, and what that costs.**

- **A Domain model for the factory Workstream.** `packages/board/src/factory/store.ts:10` declares
  the six phases, and transitions are hand-written across `kernel.ts`, `adopt.ts`, `daemon.ts`, and
  the CLI. This is a second state machine, but it has exactly one writer (the factory kernel), so
  it is not yet a Domain model's problem.
- **Projections, CatchUp, Query.** The mailbox keeps its own log and state in
  `packages/protocol/src/mailbox.ts` and `packages/board/src/mailbox/service.ts`; it is a third
  state machine with its own receipts.
- **The stack declaration.** `packages/board/alchemy.run.ts` exists and is committed
  (`e7d99e2e`), so ADR 0001's file claim is true. The stack is empty: `providers: Layer.empty` and
  `Effect.succeed({})` declare no room, worktree, or service resources. `alchemy plan --no-input`
  resolves an empty plan, which is not the same as a resource plan. Either the stack grows the
  resources the ADR names, with a plan test, or the ADR's `plan` sentence is narrowed to "the
  authoring path resolves". ADR 0001 is wrong only about the resources, not the file.

**Where we duplicate.** The Workstream phase machine and the mailbox state machine are the two
places. Neither duplicates Alchemy's hosting; they duplicate the idea of a state machine that
Alchemy's Domain already types.

**Verdict.** Room is the good example: one aggregate, one model, the store defers. Do not add a
second state machine to the factory until it has a second writer. Cut 11 is a boundary, not a
port.

---

## 3. agentOS — `@rivet-dev/agentos-core 0.4.9`

**Pin.** `packages/room/package.json:38`. Embedded Core only: no hosted endpoint, no Rivet
credential (ADR 0001, ADR 0002).

**What we call.**

| API                                                        | Site                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `AgentOs.create({ user, database, mounts })`               | `packages/room/src/AgentOs.ts:55`, `:67`                  |
| `database: { type: "sqlite_file" }`                        | `AgentOs.ts:60`; path from `agentOsDatabaseFile` at `:21` |
| `mounts: [hostDirMount("/workspace", worktree)]`           | `AgentOs.ts:66`                                           |
| `vm.filesystem.mkdir`                                      | `AgentOs.ts:69` (unmounted VM only)                       |
| `vm.process.execFile(command, args, { cwd, output, env })` | `AgentOs.ts:119`, `:124`, `vm-supervise.ts:59`            |
| `vm.process.spawn(command, args, { cwd, env })`            | `vm-supervise.ts:41` (a room service)                     |
| `vm.network.httpRequest({ port, path, … })`                | `vm-supervise.ts:25` (the preview proxy)                  |
| `vm.dispose()`                                             | `AgentOs.ts:74`                                           |

The service pid is the only fact kept: `packages/room/src/cli.ts:397` writes
`{ id, port, pid, service }`, and `:392` stores `runtime.previewPort` in the room file.

**What we rely on it for.** A per-room filesystem and process table with a durable SQLite
database, a read-write host projection of the worktree, and an HTTP bridge into the guest. It is
the isolation seam. The executor lease environment is merged into the guest environment at
`vm-supervise.ts:47`–`:52`.

**What we are not using (declarations at `agentos-core@0.4.9 dist/agent-os.d.ts`).**

- **Process lifecycle.** `process.list` (`:545`), `get` (`:544`), `tree` (`:546`), `wait` (`:547`),
  `signal` (`:548`), `kill` (`:549`), `readOutput` (`:556`). We spawn a service and then never ask
  the VM about it again.
- **Software declarations.** `AgentOsOptions.software` (`:410`) and
  `software.list/installed/link/install/uninstall` (`:637`–`:645`). Every VM takes the default
  bundle (`defaultSoftware` defaults true, `:420`–`:425`); nothing in the repo declares what a
  room's commands need.
- **Snapshots.** `filesystem.export({ maxBytes })` (`:628`) and `RootSnapshotExport`. Pause/resume
  is a flip of the room file (`packages/room/src/store.ts`, `resumeRoom`), and the only durable
  copy is the VM's `agentos.sqlite`.
- **Permissions.** `AgentOsOptions.permissions` (`:474`, merged over the sidecar's service
  allowlist) and `AgentOsSidecar.describe()` (`:898`). The VM runs on the default sandbox policy;
  `/presence` cannot say what a room may reach.
- **Terminals.** `terminal.open/write/resize/wait/close` (`:605`–`:612`). Correctly unused: Herdr
  owns terminals (section 8).
- **Contexts, cron, language runtimes.** `contexts` (`:596`), `cron` (`:645`),
  `javascript`/`typescript`/`python`. Not needed for a room today; not a duplication.

**Where we reimplement or duplicate.**

- **Service supervision.** The room starts a guest process and forgets it. `Service.ts:76`,
  `probeHealth`, observes the host-side port; a service that exited and one that never bound are
  both `unhealthy`. The VM already knows the difference (`process.get`/`wait`).
- **A second supervisor.** `VmSupervisor.ts:94` (`readVmStatus`) keeps a pid, a socket file, and
  `alive(pid)` to decide `running | stale | absent`. That is a supervisor over a sidecar that
  already supervises the VM; the host record is bookkeeping, not authority. It is defensible as a
  host shim for "is the sidecar process still there", but the record must not grow lifecycle verbs
  the VM already has.
- **The preview route.** `packages/board/src/preview.ts` plus `vm.network.httpRequest` is the host
  bridge. It is a shim for a real missing API: 0.4.9's `network` has exactly one member,
  `httpRequest` (`:634`). ADR 0002's "remaining gap is the VM `network.preview` bridge" names an
  API this pin does not have. Correct the ADR; keep the bridge.
- **Snapshots.** Pause claims disk survives (ADR 0002, "pause keeps the disk"); nothing tests it.
  `filesystem.export` is the API that makes the claim checkable and portable.

**Verdict.** This is the seam with the most unused API and the most invented state. Cuts 1–5.

---

## 4. Rat King / AT Protocol — no package; fixtures pinned

**Pin.** The interop fixture is Rat King at `9c49c10b843f8ee5626a5511aa2f28949767c994`, read from
`RAT_KING_CHECKOUT` (`docs/cutover.md:22`–`23`; `packages/board/test/mailbox-rat-king.test.ts:6`–
`:9`, lexicons `fixtures/v0`). There is no dependency and no vendored lexicon.

**What we call / carry.**

- The procedures and wire shapes, as plain types and pure decisions:
  `packages/protocol/src/mailbox.ts` — `Envelope` (`:17`), `DeliveryState` (`:35`), `Receipt`
  (`:37`), `Harness` (`:47`), `Lease` (`:54`), `MailboxSnapshot` (`:75`), plus `send`, `deliver`,
  `ack`, `acquire`, `release`, `list`.
- The server over those procedures: `packages/board/src/mailbox/service.ts:18` imports them; the
  snapshot loads at `:100` and saves at `:117`.
- DID: `packages/board/src/mailbox/did.ts` — `DidError` (`:9`), `didKeyFromEd25519` (`:50`),
  base58btc/Ed25519 (`:12`–`:46`), and `resolveDidWeb` (`:105`).
- The design record: `docs/at-seam.md` §2 "What Rat King is, verified"; `docs/otp-and-at.md` names
  the lexicons as the second primary source.

**What we are not using.**

- **The lexicons as the schema source.** `packages/protocol/schema/` carries the jig, cutlist, and
  intent records — no `mailbox` lexicon. The DID, lease, receipt, and envelope shapes are
  hand-written TypeScript with hand-written guards (`mailbox.ts:98`–`:146`).
- **AT identity.** did:plc resolution, handle resolution, PDS/repo/event-stream. `docs/at-seam.md`
  decides a bench needs a name, a lease, a journal, and one PR — not a PDS. That is a decision, not
  a gap.
- **Rat King as a library.** ADR 0001 rejects it for the milestone ("Pre-alpha, no running network
  or deploy automation, and no package to consume"). The borrow is vocabulary and bytes.

**Where we duplicate.** Two concerns, one shape each:

- The local DID codec is a second implementation of the identity bytes the lexicons describe. It
  is small and tested (`mailbox-rat-king.test.ts` admits the fixture), but it can drift from the
  fixture without any gate noticing, because the fixture test skips when `RAT_KING_CHECKOUT` is
  unset.
- The procedure shapes are a second, unversioned schema. When Rat King renames a field, the
  fixture test is the only thing that can fail — and only on a machine that has the checkout.

**Host-shim reason / ADR.** There is no package to call (ADR 0001), so the source of truth must be
the lexicon fixtures, checked in and versioned here. Cut 7 makes the fixture a committed gate
instead of an optional one.

---

## 5. Treadle — workspace package, pi SDK 1.5.0

**Pin.** `packages/treadle/package.json`: `@earendil-works/pi-coding-agent` via catalog, XState via
`@xstate/effect`, TypeBox. Its own format and lint are Biome, and it is excluded from the root
formatter (`.oxfmtrc.json`, `packages/treadle/**`).

**What we call (in Treadle).**

| API / module                                                                        | Site                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `createAgentSession` (Pi SDK)                                                       | `packages/treadle/src/session.ts:114`                  |
| `SessionManager`, `ModelRuntime`, `defineTool`                                      | `session.ts:7`–`:15`                                   |
| terminal states `completed \| failed \| blocked-on-human`                           | `session.ts:24`                                        |
| `ask_human` tool, with timeout                                                      | `session.ts:142`, wired at `:433`                      |
| `runSession`                                                                        | `run-session.ts:55`; exit 0/1/2 is the kernel contract |
| `Receipt` (issue, pass, budget, terminal, turns, cost, checkpoint, declared checks) | `receipt.ts:11`                                        |
| budget rule: a failed pass consumes budget unless the failure frontier shrank       | `budget.ts:19`                                         |
| `loop.config.ts` (checks, app, labels, budgets)                                     | `config.ts`                                            |
| human channels: terminal, TelePi                                                    | `human-channel.ts`, `telepi.ts`                        |

**What the factory does instead.** The factory kernel is a second pass engine:

| Concern          | Treadle                                            | Factory kernel                                                    |
| ---------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| run a pass       | `runSession` (`session.ts:114`)                    | `runPassInner` (`kernel.ts:724`), `runProcess` (`:574`)           |
| prompt           | `prompt.ts` (vision, issue, progress, last report) | `promptOf` (`kernel.ts:440`), passed as `FACTORY_PROMPT` (`:840`) |
| receipt          | `receipt.ts`, written after the checks             | `kernel.ts:27` comment, file at `:294`, counted at `:301`         |
| budget           | frontier rule (`budget.ts:19`)                     | `store.ts:54` `passesPerPhase`, receipt count                     |
| blocked-on-human | mid-session `ask_human`, timeout                   | exit 2 becomes a desk item (`kernel.ts:889`)                      |
| checks           | declared in config, run by `run-checks.ts`         | workstream gates (`gates` in the record)                          |
| human channel    | terminal or TelePi                                 | desk only                                                         |

**What we are not using.** Treadle's config hash (`config.ts` computes one; the kernel records
nothing comparable), declared-check receipts, the frontier budget, the failure-set report, the
TelePi channel, and the loop's escalation/nightly machinery.

**Where we duplicate.** The pass lifecycle is implemented twice, in two packages, with two receipt
formats and two budget rules. The factory's worker may be `intercom:<session>` (`kernel.ts:663`)
or any command; Treadle's is a Pi session with caps, cost accounting, and a mid-pass question
channel.

**Verdict.** This is the largest duplicate. The cut is the one the ticket names: the factory
invokes Treadle's run-pass/config/receipt/desk seam instead of owning a second one. Cut 6.

---

## 6. Executor — borrowed shape, evaluated at `f2582c5`

**Pin.** Not a dependency. `docs/executor.md:3` records the commit and the verdict. ADR 0005
carries the lease decision.

**What we call.** Nothing in Executor. The local broker is
`packages/board/src/factory/executor.ts`:

| Local piece                                     | Site                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| credential kinds and stored shape               | `executor.ts:9`, `:18`                           |
| 0600 JSON store, temp + rename                  | `writeJson` at `:116`                            |
| credentials file / grants file / leases dir     | `:93`, `:98`, `:103`                             |
| repository manifest `.factory/credentials.json` | `:104`                                           |
| lease minting                                   | `leaseFor` at `:304`                             |
| secret-name heuristic and base worker env       | `isSecretEnvName` `:426`, `baseWorkerEnv` `:433` |
| CLI verbs `credentials`, `grant`, `executor`    | `packages/board/src/factory/cli.ts`              |

**What we rely on it for.** Least privilege: a workstream receives only the accounts granted to
it, and a lease is the only object a VM needs (`docs/adr/0005`, "Credentials cross as leases"). The
desk remains the one human gate; Executor is not a second approval authority (`docs/executor.md`,
"The one human gate").

**What we are not using (deliberately, per the doc).** Executor's catalog, its policy table
(`allow`/`require-approval`/`block`, most restrictive wins), its approval contract with a persisted
pending request, its MCP/OpenAPI/GraphQL routers, and its QuickJS app runtime. The doc's "what to
borrow, in order" names `fumadb-effect`, the approval shape, the routers, QuickJS, and the
dashboard.

**Where we duplicate.** The broker is growing toward a gateway: a kind taxonomy, advisory/enforce
modes, a repository manifest, a conflict rule for two credentials naming one variable, and a
heuristic that guesses a secret from its name. Those are the pieces of a gateway's policy plane
without the catalog or approval plane that makes one. The heuristic is the tell: a credential is a
declared object, not a variable whose name looks dangerous.

**Verdict.** Freeze at catalog + lease. Do not add policy, approval, or a token exchange. When a
gateway is real, deadbolt is the source; the doc's borrow list stands. Cut 8.

---

## 7. Effect UI / Foldkit — `pkg.pr.new@87a704b`

**Pin.** `pnpm-workspace.yaml:44`, with the explanation at `:40`–`:43`: not on npm, so the URL and
SHA are the identity, and the snapshot's peer is `effect ^4.1.4`, under the catalog line.

**What we call.**

- The one view runtime: `packages/board/view/src/main.ts:1`–`:3` (`Command`, `Head`, `UiSchema`,
  `View`, `Html`), `vision.ts:2`, `entry.ts:1` (`BrowserHost`), and the tests' `Scene`/`Locator`
  from `@effect/ui/testing`.
- Cutlist's dual recognition, which is deliberate: `packages/cutlist/src/crawl.ts:77`–`:88` states
  both builder vocabularies; `BUILDER_HTML_TAGS` at `:141`; the builder-call set at `:669`/`:704`;
  the signature reads it at `signature.ts:48`.

**What we rely on it for.** One Effect-native view, tested by rendering a `Scene`, served by the
board. Cutlist's job is to describe a module's builder without installing either one.

**What we are not using.** Foldkit is not a dependency anywhere (no catalog entry, no manifest
entry). It is recognized in source and never imported.

**Where we duplicate.** Nowhere today. The risk is a second view runtime: a Foldkit app and an
Effect UI app in the same repo, each with its own mounting, tests, and build. The catalog already
distinguishes them; no gate refuses the second runtime.

**Verdict.** Dual support in the crawler is correct and should stay. No second runtime. Cut 12 is
a guard, not a port.

---

## 8. Herdr — control CLI and one mod

**Pin.** No package. The surfaces are `herdr-app` (control the running app) and `hc` (run a
terminal), both on `PATH`; the fallback ladder is in `docs/herdr-factory.md` ("Open ladder").

**What we call.**

- `packages/board/src/cli.ts:448` returns `"rex" | "herdr-app" | "herdr-terminal"`; the app rung
  is chosen at `:477` and `:486`. The address must come from the live snapshot.
- `packages/board/src/factory/kernel.ts:610` `runInTerminal`: `hc.value` at `:631`, subcommand
  `run` at `:633`, with `--name`, `--label`, `--cwd`, `--no-parent`, `--timeout`. The pass worker
  runs in that terminal, so the factory panel can focus it.
- The panel: `herdr/factory/mod.json:1` (`{"place":"none"}`), `main.js:276`
  (`run("agent.focus", { terminal })`), and `presence.js:163` decoding `/presence` at the seam.

**What we rely on it for.** Terminals and focus. The board never opens a pty; the kernel never
speaks a terminal protocol.

**What we are not using.** The mod API's `spaces()`, `agents()`, `terminals()`, `focused()` beyond
the one focus call, and mod-local state. `docs/herdr-factory.md` deliberately keeps the panel a
reader of `/presence` ("Do not duplicate the JSON shape", "never reads `~/.factory` directly").

**Where we duplicate.** Nowhere. The only fallback is Terminal, and only after the app rung.

**Verdict.** Called, not reimplemented. Cut 13 is a guard against a future `node-pty` in board.

---

## 9. Tailscale — the CLI is the API

**Pin.** No package. Binary resolution is `TAILSCALE_BIN`, then `PATH`, then
`/Applications/Tailscale.app/Contents/MacOS/Tailscale` (`packages/board/src/tailnet.ts:57`–`:63`).

**What we call.**

- `execFile` at `tailnet.ts:48`, `["status", "--json"]` at `:103`, decoded at `:85`;
  `discoverTailnet` at `:94`.
- Peer reads: `packages/board/src/fleet.ts:117` tries `/.well-known/presence.json` then `/presence`;
  `fleet` at `:135`; MagicDNS normalisation at `:231`.
- `/presence` carries the tailnet document (`packages/board/src/cli.ts:298`) and strips IPs on the
  wire at `:401`–`:407`.

**What we rely on it for.** The address book: which machines exist, their MagicDNS names, and
whether they are online. It is not presence itself (`tailnet.ts:9`–`:12`).

**What we are not using.** `tailscale serve` (no TLS today; ADR 0005 defers it: "Tailscale Serve can
add TLS later without changing the identity tuple"), funnel, ACL APIs. MagicDNS supplies the
machine name; the board path supplies the service.

**Where we duplicate.** Nowhere. The board does not implement discovery, NAT traversal, or a second
name service. Peer identity is the tailnet node (ADR 0005).

**Verdict.** Called. Cut 13 folds it into the no-runtime guard.

---

## 10. SQLite — `node:sqlite`

**Pin.** Node's built-in module at Node >= 24.18 (`package.json` engines).

**What we call.**

- The factory journal: `packages/board/src/factory/journal.ts:3` imports `DatabaseSync`; `:26`
  opens or creates the file; `:36` snapshots with `VACUUM INTO` (one table, `passes`).
- agentOS's own durability: `packages/room/src/AgentOs.ts:60` gives every VM a `sqlite_file` at
  `:21` (`agentos.sqlite`).

**What we do not use it for, and what we use instead.**

| State                   | Stored as                               | Site                                  |
| ----------------------- | --------------------------------------- | ------------------------------------- |
| workstream records      | JSON files                              | `packages/board/src/factory/store.ts` |
| mailbox messages/leases | one whole-state JSON snapshot per write | `mailbox/service.ts:117`              |
| room record             | `room.json`                             | `packages/room/src/store.ts:53`       |
| journal snapshots       | SQLite via `VACUUM INTO`                | `factory/journal.ts:36`               |
| VM filesystem/state     | SQLite via agentOS                      | `room/src/AgentOs.ts:60`              |

**Where we duplicate.** The mailbox reimplements a durable log as a full JSON snapshot with temp +
rename (`mailbox/service.ts:117`–`:129`). Every send rewrites every message, and a crash between
the write and the rename leaves the previous snapshot — correct, but it is a log implemented as a
photograph, on a machine that already has SQLite in the journal. The executor doc reaches the same
conclusion from the other end: borrow `fumadb-effect` to "replace the mailbox's JSON snapshot; keep
`mailbox-domain` procedures" (`docs/executor.md`, "What to borrow, in order").

**Verdict.** SQLite is called where it is cheapest and reimplemented where correctness matters.
Cut 9 moves the mailbox, not the journal.

---

## The duplication register

One row per concern that exists twice. This is the list the backlog is cut from.

| Concern                    | Must live in                       | Second copy                                           |
| -------------------------- | ---------------------------------- | ----------------------------------------------------- |
| pass lifecycle             | Treadle (`session.ts:114`)         | factory kernel (`kernel.ts:724`)                      |
| pass receipt               | Treadle (`receipt.ts:11`)          | `kernel.ts:27`, `:294`                                |
| pass budget                | Treadle (`budget.ts:19`)           | `store.ts:54` + receipt count                         |
| pass prompt                | Treadle (`prompt.ts`)              | `kernel.ts:440`                                       |
| human question channel     | Treadle (`human-channel.ts`)       | exit 2 to desk (`kernel.ts:889`)                      |
| room lifecycle state       | Alchemy Room/Move models           | none (room is the good case)                          |
| workstream lifecycle state | Alchemy Domain (when a 2nd writer) | `factory/store.ts:10`                                 |
| mailbox state              | Domain or SQLite                   | `protocol/src/mailbox.ts`, JSON snapshot              |
| guest service lifecycle    | agentOS `process.*`                | room service pid and exit code                        |
| guest durability           | agentOS `filesystem.export`        | room pause/resume snapshots                           |
| DID/lease/receipt wire     | Rat King lexicons                  | `protocol/src/mailbox.ts`, `board/src/mailbox/did.ts` |
| credential policy          | Executor (later)                   | `factory/executor.ts` broker                          |
| API surface for a peer     | board `/presence`                  | Herdr decode (`herdr/factory/presence.js`, read-only) |

---

## The backlog, ranked

Ranked by "what silently lies or leaks first", then by cost. Every cut names the owning package,
the API to call instead, and the test that proves it. Cuts 1 and 2 are landed; the rest are
not started.

### 1. Report a room service from the VM's process table, not from a forgotten pid

- **Owner:** `room`
- **Cut:** replace the pid-in-a-log (`room/cli.ts:397`) with the guest process id held on the room
  record; answer "is it running" with `vm.process.get`/`list`, and stop with `kill`
  (`agent-os.d.ts:544`–`:549`). `observeRoomService` (`Service.ts:144`) keeps the HTTP probe as the
  health observation but may no longer infer "not listening" from "process gone"; it reports
  `stopped` with the exit code the VM already has.
- **Proof:** `packages/room/test/service.test.ts` gains a service that exits; the room reports
  `stopped` with its exit code without a port probe, and `room down --service` kills a service that
  ignores the socket.
- **Size:** S–M.
- **Status:** landed at `2da831f9`; the guest process is the truth, and a legacy pid still decodes.

### 2. Make pause mean a snapshot, and prove it

- **Owner:** `room`
- **Cut:** `vm.filesystem.export({ maxBytes })` (`agent-os.d.ts:628`) on pause, restore on resume;
  record the snapshot path beside `runtime` in the room file. ADR 0002's "pause keeps the disk"
  becomes a tested claim instead of a sentence.
- **Proof:** new `packages/room/test/vm-snapshot.test.ts`: write a file, pause, resume into a fresh
  VM directory, read the file back; a second pause of a resumed room is not a duplicate export.
- **Size:** M.
- **Status:** landed at `fbd20f71`; pause exports a root snapshot, resume boots a fresh VM on it,
  and a snapshot carrying `/workspace/*` is refused as an API gap rather than restored.

### 3. Declare a room's software instead of inheriting the default bundle

- **Owner:** `room`
- **Cut:** `AgentOsOptions.software` (`agent-os.d.ts:410`) names `git`, `node`, `pnpm`; assert with
  `software.installed()` (`:637`). A Core upgrade that drops a tool becomes a boot failure, not a
  pass that fails in the guest with `command not found`.
- **Proof:** new `packages/room/test/vm-software.test.ts`: a VM created with the declaration lists
  the declared commands; a VM created with `defaultSoftware: false` and the declaration still runs
  them.
- **Size:** S.
- **Status:** partly landed at `18d7e038`. The room declares software, passes registry entries,
  and records `software.installed()` plus `missing`; a bare VM honors the declaration. The
  default is deliberately empty, not `["git"]`: a registry package is downloaded before boot, so
  defaulting to `git` makes every room depend on `releases.rivet.dev`. `node` and `pnpm` are not
  published by the 0.4.9 registry; ADR 0006 records both gaps. `installed()` also does not list
  Core's vendored bundle, so a default room records `installed: []` rather than inventing one.

### 4. Declare and report the VM's permissions

- **Owner:** `room`
- **Cut:** set `AgentOsOptions.permissions` (`agent-os.d.ts:474`) explicitly (the network allowlist
  at minimum) and surface `AgentOsSidecar.describe()` (`:898`) in the room record and `/presence`,
  so an operator can read what a room may reach instead of assuming the default.
- **Proof:** new `packages/room/test/vm-permissions.test.ts`: a guest fetch to a host outside the
  allowlist fails; `describe()` is echoed in the room's JSON and in `/presence`, and a missing
  description renders no line (the environment-plan rule).
- **Size:** M.
- **Status:** blocked at `agentos-core@0.4.9`; ADR 0007 records the probe. A default-deny
  `network` policy with `net.listen` or `net.http_listen` allowed still stops the guest
  listener; only `default: "allow"` keeps a room service alive. `CreateVmConfig.listen` is not
  on `AgentOsOptions`, and `describe()` has no policy member. No permission field is written
  rather than record a policy the VM did not apply.

### 5. Use the VM's preview and terminal surface only where the host has none

- **Owner:** `room`
- **Cut:** keep `network.httpRequest` (`:634`) as the preview bridge — 0.4.9 has no
  `network.preview` — and correct ADR 0002 to name what exists. Where a host terminal is currently
  spawned around a guest command, use the guest's `terminal` only if the command must survive the
  supervisor; otherwise keep `execFile`.
- **Proof:** `packages/room/test/cli.test.ts` (preview route returns the guest's status and body)
  plus a doc check in `scripts/spec-check.mjs` that the ADR and the d.ts agree on the API name.
- **Size:** S.

### 6. Run the factory pass through Treadle

- **Owner:** `board` (factory kernel), consuming `treadle`
- **Cut:** `runPassInner` (`kernel.ts:724`) invokes `packages/treadle/src/run-session.ts` with a
  generated `loop.config.ts` (the prompt, caps, and declared gates), and reads the `Receipt`
  (`treadle/src/receipt.ts:11`) instead of writing its own. Delete the duplicate prompt
  (`kernel.ts:440`), receipt (`:294`), and budget count (`:301`). Keep the kernel's event log and
  checkpoint; those are factory state, not pass state. The `intercom:` worker stays a Treadle
  worker variant, not a second path.
- **Proof:** new `packages/board/test/kernel-treadle.test.ts`: a stub session that exits 2 creates
  exactly one desk item and no checkpoint; a session that exits 0 records the receipt Treadle
  returned (turns, cost, declared checks) and the checkpoint; the old `FACTORY_PROMPT` path is gone.
- **Size:** L.

### 7. Make the Rat King fixture a committed gate

- **Owner:** `protocol`, with `board` as the second consumer
- **Cut:** add a `mailbox` lexicon under `packages/protocol/schema/` for
  `Envelope`/`Receipt`/`Lease`/`NameRecord` (`protocol/src/mailbox.ts:17`–`:75`), and vendor the
  `fixtures/v0` send/deliver/ack inputs and outputs beside it. The lexicons are the source; the
  TypeScript decoders are checked against them. `board/test/mailbox-rat-king.test.ts` runs from the
  committed fixture, never only from `RAT_KING_CHECKOUT`. Re-pin Rat King in one place.
- **Proof:** `packages/protocol/src/lexicon.test.ts` plus `lexicon-compat` over the new lexicon; the
  Rat King fixture test passes with no environment variable; a field rename in the fixture fails
  compat rather than silently changing the local decoder.
- **Size:** M.

### 8. Freeze the local credential broker at catalog and lease

- **Owner:** `board`
- **Cut:** no new policy, approval, or token-exchange feature in
  `packages/board/src/factory/executor.ts`. Add the boundary as a test: a credential value must
  never appear in a workstream record, a receipt, `/presence`, or a report. When a gateway is real,
  deadbolt is the source and the broker retires behind it.
- **Proof:** new `packages/board/test/executor-freeze.test.ts`: seed a credential with a unique
  value, run the factory's read paths, and assert the value appears in none of them; assert the
  `factory credentials` verb surface is exactly the documented set (a new verb fails the test until
  the doc is updated).
- **Size:** S.

### 9. Give the mailbox a durable log

- **Owner:** `board`
- **Cut:** move `mailbox/service.ts` from a whole-state JSON snapshot (`:117`) to SQLite with an
  append log, keeping the `@autotelic/protocol` procedures untouched. The journal already shows the
  shape (`factory/journal.ts:26`). If `fumadb-effect` is adopted, it is the layer, not a second
  store.
- **Proof:** new `packages/board/test/mailbox-durability.test.ts`: write and ack a message,
  hard-kill the process between the write and the ack, reopen; the acked `seq` survives, and the
  unacked message is re-delivered. A snapshot no longer rewrites the whole log per send.
- **Size:** M.

### 10. Finish one Effect v4 target at a time, starting with the error classes

- **Owner:** `board`, `room`
- **Cut:** the target at `kernel.ts:499`. First coherent step: replace the seven `extends Error`
  classes with `Data.TaggedError` and use `Effect.catchTag` at the seam (`Supervisor.ts:44`,
  `executor.ts:76`, `AgentOs.ts:14`, `Worktree.ts:25`, `Mailbox/log.ts:34`, `ExecutorLease.ts:16`,
  `room/store.ts:57`). Then Logger, then Clock, then Schedule — each with its receipt counters
  before and after.
- **Proof:** new `packages/board/test/effect-residuals.test.ts` counts `throw new`, `Date.now(`,
  `console.*`, and `extends Error` in the two packages and fails when a count rises; the same counts
  are written into the pass receipt.
- **Size:** M per step.

### 11. Keep the second state machine out of the factory

- **Owner:** `board`
- **Cut:** the Workstream phase machine (`factory/store.ts:10`) stays a plain record while it has
  one writer. When a second writer appears (a peer, a daemon in another process, a UI that
  decides), it becomes a Domain aggregate like `Room` (`room/src/Room/Room.aggregate.ts:37`) and the
  store defers to `predict` as `room/store.ts:103` does. Until then, no new transition logic
  outside `kernel.ts`.
- **Proof:** new `packages/board/test/workstream-model.test.ts`: a transition from `done` to any
  phase is refused by one function, and a controller test refuses a second writer; the test fails
  if a phase is assigned outside the kernel.
- **Size:** S now, M when the writer appears.

### 12. Keep Effect UI the only view runtime

- **Owner:** `cutlist` (the catalog), `board/view` (the runtime)
- **Cut:** none to the dual support. Add a guard: a module's builder is recorded in the catalog
  (`crawl.ts:141`, `:669`), and a test refuses a second mounted view runtime in the repo. A Foldkit
  module may be described; it may not be served.
- **Proof:** `packages/cutlist/src/catalog.test.ts` already proves the Foldkit fixture yields
  `foldkitCalls: ["card"]` (`:165`). Add the mirror for an Effect UI component (`Html.component`
  named `BoardView`) and a workspace check that only `packages/board/view` depends on `@effect/ui`.
- **Size:** S.

### 13. Keep terminals, the tailnet, and the clock out of local code

- **Owner:** `board`
- **Cut:** a boundary, not a port. No pty library, no tailnet protocol, no clock implementation in
  board. Herdr (`cli.ts:448`, `kernel.ts:610`) owns terminals; Tailscale (`tailnet.ts:48`,
  `fleet.ts:135`) owns discovery; Effect's `Clock` owns time (cut 10).
- **Proof:** new `packages/board/test/seams.test.ts` (or an oxlint architecture rule) refuses
  `node-pty`, `blessed`, `ssh2`, a second `tailscale` binary invocation outside `tailnet.ts`, and a
  new `Date.now` in a module that already has an `at` parameter.
- **Size:** S.

---

## What is deliberately not a cut

- **Herdr, Tailscale, SQLite as calls.** Sections 8–10 confirm we call them. Only the mailbox
  storage (cut 9) reimplements a concern; the rest are boundaries (cut 13).
- **Foldkit support in cutlist.** Dual recognition is how a catalog stays honest about a codebase
  it does not own. Cut 12 guards the runtime, not the reader.
- **A second policy engine.** Executor's policy table is not imported; the desk remains the one
  human gate (`docs/executor.md`, "The one human gate"). Cut 8 keeps it that way.
- **A PDS or a hosted agentOS actor.** Both are decisions, not gaps: ADR 0001 (embedded Core,
  rat-king rejected) and `docs/at-seam.md` (a bench needs a name, a lease, a journal, and one PR).
- **The factory's event log and checkpoint.** Those are factory state, not pass state; cut 6 moves
  the pass, not the record.
