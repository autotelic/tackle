# Alchemy as the shop's provisioner

Read against the v2 docs (the v2 pages, not the v1 `/docs/*` redirect) and
`alchemy@2.0.0-beta.87`, plus `gh` on `alchemy-run/alchemy`.

## What Alchemy v2 actually guarantees

A **Stack** is a default-exported Effect that declares **Resources**. A resource is a logical id
plus input props; yielding it registers desired state and returns typed **Outputs**; nothing touches
the cloud until deploy. State lives in a pluggable store (files, SQLite, S3, Postgres; the Postgres
store takes a per-`(stack, stage)` advisory lock for the run). A **Stage** is an isolated instance
with its own state and physical names (`dev_$USER`, `pr-147`, `prod`).

The engine plans each resource as create / update / replace / delete / no-op, then calls the
provider's **single `reconcile`**: observe → ensure → sync, convergent and idempotent, with
deterministic physical names so a retry finds the resource instead of duplicating it. `diff` decides
update vs replace (`deleteFirst` where both cannot coexist). **`read`** drives adoption: owned →
silent adopt, `Unowned` → `OwnedBySomeoneElse` unless `--adopt`. **`renamedFrom`** migrates a state
row across a logical-id change instead of replacing. Every resource has a **removal policy**:
`destroy` (default) or **`retain`** (drop the state row, leave the object) — and the policy is
evaluated at delete time, so it can change later.

Other commands that matter: `plan`, `drift` (re-observe; exit 2 on unrepaired drift), `destroy`,
`unsafe nuke`, `dev` (local emulation, Miniflare, tunnels), `state`. Phases are `up`, `destroy`,
and **`read`** (run the stack, touch nothing, reconstruct outputs from state). Secrets are encrypted
in state with a passphrase; bindings are typed env. Providers are Effect Layers, and the type system
refuses a resource whose provider layer is missing.

The catalog is the part the shop doc did not assume: **Docker** (images, containers, networks,
volumes, swarm), **sandboxes** (Daytona, E2B, Modal, Boat, Archil, AWS Nitro), **machines** (Fly,
Hetzner), **Command** (build/dev/exec), **Git / GitHub** (clone, push, PRs, secrets, events), ACME,
Axiom. That is the provider port, written by someone else.

Versions: `2.0.0-beta.87` (2026-11-12) peers on `effect ^4.1.4`; this workspace pins `4.0.5`.
The Celld/Rivet provider PR (#1127) is still **open**, so the room's deployed-host story stays
blocked, but a local/Docker/Daytona bench does not depend on it.

## Why it fits the bench

- **The shop's provider port (§3.2) collapses into provider layers.** Bench declares; Docker,
  Daytona, Fly, Hetzner provide. "Three providers, in order" becomes configuration, not code.
- **`Bench` is a custom resource** whose provider implements reconcile/delete/diff/read against a
  directory + a container. The docs' custom-resource guide says a resource is just a function.
- **The host must not be a stage.** Stage is isolation; a bench keeps its identity across hosts.
  Split the resource tree instead:
  - **data children** (`worktree`, `journal`, `outbox`, `desk`) with removal policy **`retain`**;
  - **runtime children** (container/sandbox/machine) with `destroy`;
  - a host change replaces the runtime only, and the data is adopted on the target.
- **Adoption is the move handshake.** `read` should return owned only when the target can prove
  bench id + generation + journal hash. A stale copy returns `Unowned` → `OwnedBySomeoneElse` →
  quarantine. That is the doc's "a fork is quarantined, not merged", with a typed error.
- **`renamedFrom`** is the precedent for a scope or repo rename: migrate the row, keep the physical
  resource, never replace the journal.
- **`phase: read` + outputs = `bench status --json` / the continuation token.** The org can fold
  inventory and pins without a write path.
- **`drift --repair`** answers "the container is not what it claims", with exit 2 as the signal.
- **`alchemy.test` isolated scopes** give P2's fence tests a cleanup story.
- **Daytona** is the closest match to the container: boots from a warm snapshot, own filesystem and
  processes, idle stop keeps the disk, stopped sandboxes can be archived. It is L1/L2 with managed
  snapshots — not the L3 memory resume the shop's table reserves for orbs.

## What Alchemy does not solve, and the new risks

- **No long-lived lease.** State locking is per deploy run, not a writer fence. The vise stays
  board's.
- **No durable conversation.** pi-durable stays; Alchemy state is a plan/apply inventory.
- **No move.** `replace` creates new then deletes old — correct for stateless dependents, fatal for
  a journal. A bench move is copy + adopt, **never replace**; `deleteFirst` is not a fix.
- **Destructive defaults.** `destroy`/nuke delete; mitigate with `retain` on data and a Bench-level
  archive. `retain` protects from Alchemy, not from a provider's own cascade.
- **Ownership proof is tags/naming.** Ours must be stronger: id + generation + journal hash.
- **Secrets in state.** Fine for cloud provider credentials, wrong for a bench's runtime secrets;
  those stay injected by the host.
- **Three stores, three authorities:** Alchemy state (inventory), pi-durable (journal), lease (fence).
  Never collapse them.
- **Dependency cost.** `effect ^4.1.4` means bumping the workspace pin (and platform-node, joggle's
  ai pin) or isolating the package; beta churn argues for an exact pin, like Effect.
- **Don't model the agent as a resource.** Reconcile must provision the container, not keep the
  conversation alive; otherwise every deploy restarts the bench.

## Design sketch

```ts
Alchemy.Stack(
  "shop",
  { providers: Layer.mergeAll(Docker.providers(), Alchemy.localState()) },
  Effect.gen(function* () {
    const bench = yield* Bench("dev-1575", {
      scope: { kind: "github-label", label: "dev-1575", base: "develop" },
      repo: "acme/web",
      host: "macbook",
      kit: { setup: ".agents/setup", resume: ".agents/resume" },
      checks: ["jig check", "pnpm test"],
      budgets: { tokensPerDay: 4_000_000 },
    })
    return { status: bench.status, watermark: bench.seq }
  }),
)
```

`Bench` composes data children (`retain`) and one runtime child (`destroy`); its `diff` treats host
changes as runtime replacement, never data replacement; `delete` archives; `read` proves ownership
by id + generation + hash. A separate `bench move` performs quiesce/release/seal/copy, then deploys
the target with adoption; the lease handoff at generation + 1 is the shop's, not Alchemy's.

## Prototypes

- **A0 (half day): the dependency probe.** Scratch stack on `beta.87` with Effect 4.1.4; one custom
  resource and one `Docker.Container`. Go/no-go on the Effect bump.
- **A1 (1–2 days): `Bench` + worktree provider.** Data children `retain`, runtime `destroy`;
  `alchemy plan/deploy/destroy`; test scopes; assert delete keeps the journal.
- **A2 (1 day): Docker services + drift.** `bench.json.services` → containers with health checks;
  kill one, `drift --repair`; measure wake time on tackle.
- **A3 (1 day): adoption/move.** Copy a bench, adopt with a matching generation; corrupt the
  generation → `OwnedBySomeoneElse` → quarantine.
- **A4 (half day): rename.** `renamedFrom` a scope; assert the journal and volume survive.
- **A5 (1 day): read-phase status.** Outputs = continuation token; org folds pins, writes nothing.
- **A6 (2 days): Daytona bench.** Warm snapshot, start/stop/archive, volume reattach. Kill if a
  volume can attach to two sandboxes (fence leak) or start exceeds ~30s.

## Recommendation

Adopt Alchemy as the shop's provisioner and `Bench`'s provider layer. Keep the lease, journal,
move, and portfolio outside it. The strategic effect is that the shop doc's provider port becomes
configuration, and bench's defensible work moves to the seam where this repo already has code:
fence, journal, move, checks, portfolio.
