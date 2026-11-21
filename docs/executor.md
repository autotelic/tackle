# Executor: augment and borrow, do not replace

Evaluated at Executor `f2582c5` (MIT), against the local runtime and source.

## Verdict

**Augment as a gateway; borrow the primitives; do not host our state in it.**

Executor is an MCP tool catalog, account/credential broker, policy and approval plane, and a
TypeScript app host. It is not a worktree, terminal, VM, process supervisor, session multiplexer,
DID authority, or lease fence.

## What it is

- Apps are TypeScript `defineApp` modules. Queries and mutations become MCP tools; each declares
  its own approval (`always`, `never`, or a function over the decoded input); SQLite migrations,
  schedules, webhooks and a UI are part of the same app.
- Self-host is one container: embedded PGlite, Better Auth, QuickJS app workers, dashboard.
  Cloud swaps Better Auth for WorkOS behind an `AccountProvider` seam.
- Apps are owned by `organization:<id>`. Organization removal is a durable workflow that purges
  the owner store, auth records, billing and webhooks.
- Access policy is a table per owner — `{pattern, action, position}` — with actions
  `allow`, `require-approval`, `block`; the most restrictive decision wins across organization
  and user scopes. Imported tools have no function hook. A user preference may narrow an
  organization guardrail, never weaken it.

## The one human gate

Do not run two approval systems. The desk is the gate for work that needs a person; Executor
owns credentials and the tool catalog. Executor may require approval on a tool, but it must not
become a second authority for room or mailbox transitions.

## Two axes, not one

Importing the policy algebra wholesale hides a distinction:

- **Authority** is one-way. The narrowest scope may make a wide rule stricter, never looser;
  organization guardrails are the floor. This is what `shop.md` now states.
- **Applicability** is not authority. A file-scoped exemption may loosen a wide rule —
  `packages/board/src/fleet.ts` does — but only in writing, with a reason and a fixture. It changes
  where a rule applies, not who may permit what.

A policy table does not license an exemption, and an exemption does not grant authority. Keep the
words separate so a later reader cannot turn one into the other.

The real policy spec waits for a second **authority** consumer, not a second policy table.

## Why it does not replace anything we have

- `room` owns a worktree and a process group; Executor owns neither.
- `board` supervises local rooms; Executor has no local machine supervision.
- Herdr and Rex own terminals and sessions; Executor does not.
- The mailbox's fence is a DID authority and lease, not an account. An Executor app's data dies
  with the organization, by an explicit asynchronous workflow rather than a schema cascade.
  `owners.remove({owner})` is more deliberate, not less: it is a workflow we would have to trust.

## How to use it

Gateway only. Connect MCP/OpenAPI/GraphQL services and accounts, set policy, point agents at
Executor's MCP endpoint. Keep canonical state outside: room records, mailbox log, leases, fleet
presence. Executor may own credentials and routing for tools; it may not own the records.

Per-operation approval functions are an app-code feature; imported tools get the policy table
(policy as a table, `allow`/`require-approval`/`block`, most restrictive wins). The fence
therefore stays inside the tool (`board_fleet`, `mailbox_*`, `room_move`); an Executor approval
is UX around that check, not the grant. If a thin approval app is ever installed, it owns no state
and is disposable.

## What to borrow, in order

1. **`packages/fumadb-effect`** — MIT Effect v4 schema, query and migration layer over SQLite and
   Postgres. Replace the mailbox's JSON snapshot; keep `mailbox-domain` procedures. The package
   is not published; vendor or port the source with attribution.
2. **The approval contract** — input-aware, three outcomes, persisted pending request, resume by
   model/native/browser. Borrow the shape, not the host. Imported tools have only the policy table,
   so the fence still lives inside our tools. Also borrow the owner-scoping precedence: a user
   preference cannot weaken an organization guardrail.
3. **MCP/OpenAPI/GraphQL routers** — `apps/mcp`, `apps/openapi`, `apps/graphql` are the shortest
   path to exposing `jig_check`, `board_fleet` and mailbox reads as tools.
4. **QuickJS app runtime** — an isolation model worth studying for untrusted room commands, not a
   replacement for a real VM or container.
5. **Dashboard/artifact patterns** — a reference for fleet and mailbox UI.

## Experiments run

- Started the local service with `executor web --foreground`; completed MCP `initialize` and
  `tools/list` against `/mcp` with its bearer token.
- Default surface: `execute`, `skills`, `resume`, `create-artifact`; `execute` runs TypeScript in
  a QuickJS sandbox with tool search/describe/call.
- Read the self-host schema, organization removal workflow, app/record ownership, approvals, and
  the self-host container definition.

## Next experiment

A gateway-only connection (no app): expose one read-only tool — `board_fleet` — through Executor's
MCP catalog with a static policy. If custom approval is required, put the check in the tool and
leave Executor as transport.
