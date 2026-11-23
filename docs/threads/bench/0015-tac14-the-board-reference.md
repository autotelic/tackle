# 0015 — TAC-14 — the board example is our reference, with two exceptions

`alchemy-run/alchemy` PR **#3506** (open, head `02e682f`, `examples/cloudflare-domain-board`) is the
closest worked example to what we are building: one Domain model on Cloudflare DOs serving a foldkit
app, an MCP server and a CLI derived from the same `Api`.

- **Borrow:** the `Thread` aggregate's claim → renew → complete/release → expire shape; the
  `Leases` policy that schedules `ExpireLease` with a deterministic command id, where a renewal
  replaces the deadline and the expiry records nothing if the task was completed in time; typed
  rejections carrying `httpApiStatus`; the `domain/server/cli/web` layout and the
  story/server/integration test split; `toCli` and `toMcp`.
- **Do not borrow:** its lease is local to one DO — it resolves claims on one instance, but it has no
  cross-host fence, generation handover, or authority countersignature. Its shared board token plus
  actor header is not per-channel authorization. `Thread` is `work.item`/desk, not the bench
  container. And `toMcp` must not become a second implementation of a surface.
- **It is open, not merged.** Pin the SHA; treat it as a reference, never a dependency.

Two things it changes: C4/C5 can copy the policy/scheduling pattern instead of inventing lease
expiry, and the bench/shop CLI can be generated with `toCli` rather than hand-written.

**Open question (one):** do bench/shop adopt `toCli` (a generated binary, which agents still shell
out to) and later `toMcp` behind the same Api, or keep hand-written CLIs? My vote: `toCli` yes;
`toMcp` later, read-only first. The binary stays the single implementation.
