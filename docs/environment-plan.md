# Environment visibility: build slices

The target is an isolated runtime per workstream: machine, worktree, services,
ports, preview URL and agent, all visible from Herdr and the web view. This
document scopes the first slice so the factory can build it without inventing
the rest.

## Current state

- `factory` runs a worker in a worktree on the local host. No container, no
  port lease, no service supervisor.
- `room` can own a worktree and a process group, but has no services or ports.
- `board` knows the tailnet peers and serves `/presence`.
- Herdr knows terminals. The factory panel knows workstreams, not environments.

## Slice 1 — environment projection (build this first)

Add `factory.environments` to `/presence` and render it. No isolation yet;
the point is to make the missing facts explicit.

For each workstream:

```jsonc
{
  "workstream": "shakti-perms",
  "machine": { "host": "macbook-pro", "dnsName": "macbook-pro.tailbd1623.ts.net" },
  "runtime": { "kind": "worktree", "path": "/Users/togmund/autotelic/shakti-perms" },
  "services": [],
  "agent": { "session": "t19", "status": "working" },
  "preview": null,
  "observedAt": "2026-05-01T12:00:00.000Z",
}
```

Rules:

- machine comes from the same tailnet document `/presence` already serves;
- agent comes from the matched presence session, or null;
- `runtime.kind` is `worktree` for now; do not claim `container`;
- `services` is an empty array until a real service declaration exists; do not
  invent a health state or a port;
- `preview` is null until a real route exists;
- missing field renders no line.

UI:

- Herdr: workstream row gains machine, runtime, agent badge; services with no
  declaration show nothing; preview only when present.
- Web: workstream card gains an Environment line with machine, runtime, agent.
- No new write path, no new server.

Acceptance:

- `/presence` carries `factory.environments` for every workstream;
- a unit test proves a workstream with no services yields `services: []` and
  null agent/preview, and a matched session fills the agent;
- the web view and Herdr panel decode the field; a missing field does not crash;
- `pnpm check` and `jig check` pass.

## Slice 2 — room services, ports, preview (later)

- declare services on a room/bench: name, command, port, health check;
- one owner per port; refuse collisions;
- preview reaches the workstream's web service through one router;
- health is observed, never inferred.

## Slice 3 — runtime and placement (later)

- container/sandbox runtime for a bench;
- machine placement through a shop API, not SSH commands;
- remote presence includes the runtime and services.

Do not build slices 2–3 in the first pass.
