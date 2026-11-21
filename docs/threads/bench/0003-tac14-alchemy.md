# 0002 — TAC-14 — Alchemy is the provider port

Read the v2 docs and `alchemy@2.0.0-beta.87`, plus `gh` on the repo (PR #1127 still open). Depth:
`docs/bench-alchemy.md`.

- **The shop's provider port (§3.2) already exists.** Docker, Daytona/E2B/Modal/Boat/Archil/Nitro,
  Fly/Hetzner, Command, Git/GitHub, Axiom are provider Layers, with missing-provider caught at
  compile time. "Three providers, in order" becomes configuration.
- **Bench becomes a custom resource**: plan → one convergent `reconcile` → replace/delete; adoption
  via `read` (owned / `Unowned` → `OwnedBySomeoneElse`); `renamedFrom` for scope renames; and a
  **removal policy** — `retain` for journal/worktree/outbox/desk, `destroy` for the runtime.
- **Move = copy + adopt, never replace.** Replace creates then deletes: for a bench that is a
  journal deletion. Host is not a stage; split data (`retain`) from runtime (`destroy`).
- **What stays ours:** the lease (state locks are per deploy, not a writer fence), pi-durable
  (Alchemy state is inventory), the move protocol, and mail.
- **Cost:** beta.87 peers on `effect ^4.1.4`; we pin `4.0.5`, so A0 is the go/no-go. The Celld PR is
  still open, so the room's deployed path stays blocked; a local/Docker bench does not need it.
- **Not sold on Daytona as L3:** stop keeps the disk, not processes or memory.

**Open question (one):** does `Bench` become an Alchemy resource with `retain` data, or does Alchemy
provision only the host and the bench stay a directory the shop owns? My vote: the former —
adoption is the only safe move handshake found so far.
