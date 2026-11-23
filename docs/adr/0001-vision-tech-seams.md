# ADR 0001 — the vision's technology seams

Status: accepted for the two-project milestone  
Date: 2026-11-23

## Context

The goal is to prepare two feature-branch factory projects against
`Shakti-Reforestation/forestbuilder` while keeping the existing `board` and `room`
packages as the factory. The linked repositories are candidates, not a mandate to add
five runtimes. The constraint is explicit: extend the little factory we have; do not
create new workspace packages.

## Decision

| Candidate                | Decision                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alchemy**              | **Adopt**                                                   | Already a `board` dependency. `alchemy.run.ts` is a real stack declaration and `alchemy plan --no-input` resolves it locally. This is the substrate seam: one desired state can later point at the local shop or a provider.                                                                                                                                                                                                        |
| **agentOS**              | **Prototype behind a room-provider seam**                   | The SDK imports on this host and exposes filesystem, process, terminal, network and preview actions. A local client defaults to `http://localhost:6420`; without a Rivet endpoint, the first filesystem write fails with `RivetError: fetch failed`. That is the correct boundary: agentOS is a provider, not the room contract. Do not add it as a hard `board` dependency until the provider seam and a real endpoint are proven. |
| **rivet-effect-cluster** | **Defer / reject for this milestone**                       | The package is experimental and peers on `effect ~4.1.4` (the repo has 4.1.5) plus `rivetkit ^3.1.2-rc.6` (not present). Adopting it would add a runtime and a cluster backend to solve concurrency that the existing journal, pass lock and lease already cover for two local workstreams. Revisit when durability crosses machines.                                                                                               |
| **rat-king**             | **Reject for this milestone; borrow the kernel vocabulary** | Pre-alpha, no running network or deploy automation, and no package to consume. Its useful vocabulary — Speaks, Remembers, Awakes, receipts, generation fences — already maps to the existing mailbox and journal. Adding it now would duplicate the seam.                                                                                                                                                                           |
| **talkto**               | **Reject for this milestone**                               | The linked project is a private Cloudflare-hosted app, not a library. The npm package named `talkto` is an unrelated 0.0.5 CLI. The existing desk plus board presence is the human/agent surface; a second chat surface is out of scope until the two-project launch works.                                                                                                                                                         |

## The seams this leaves

```text
room
  └─ RoomProvider
       ├─ local       worktree + process + leased port      today
       └─ agentOS     filesystem + process + preview        prototype, injected client

board
  ├─ journal + pass lock + lease      durable enough for two local workstreams
  ├─ Alchemy stack declaration        substrate seam, already installed
  └─ mailbox / intercom / desk        agent and human coordination

view
  └─ presence + factory status        one model, two renderings
```

The provider is an interface, not a dependency inversion of the protocol. The local
provider must remain the fallback so a missing Rivet endpoint degrades to the current
shop rather than blocking a pass.

## Captured evidence

```text
$ cd packages/board && node -e 'import("alchemy")...'
{"keys":["ALCHEMY_DEV","ALCHEMY_PHASE",...],"stack":"function","localState":"function"}

$ cd packages/board && pnpm exec alchemy plan --no-input
[INFO] Plan · live_togmund
[INFO] Plan: no resources

$ cd /tmp/agentos-spike && node -e 'import("@rivet-dev/agentos")...'
keys: AGENTOS_API_VERSION, AGENTOS_CAPABILITIES, AGENTOS_CONTRACT,
      AGENTOS_CONTRACT_HASH, AGENTOS_CONTRACT_MAJOR, createAgentOsClient

$ agentOS filesystem write without a service
[rivetkit] No endpoint provided to client. Defaulting to http://localhost:6420.
ERROR RivetError HTTP request error: Request failed: TypeError: fetch failed
```

agentOS was installed only in `/tmp/agentos-spike` for this experiment. No package was
added to the repository.

## Consequences

- The next task can introduce `RoomProvider` in `room` with local and injected
  agentOS implementations; the tests can use a fake provider until a Rivet endpoint is
  available.
- Durable concurrency is a board problem first: prove two workstreams across a daemon
  restart with the existing lease and pass lock before reaching for a cluster.
- Alchemy remains the only adopted substrate dependency; its plan is a CI-able
  declaration rather than a second deployment system.
- rat-king and talkto remain references. Their designs may inform the mailbox and desk,
  but they do not add surfaces in this milestone.
