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

| Candidate                | Decision                                                    | Why                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alchemy**              | **Adopt**                                                   | Already a `board` dependency. `alchemy.run.ts` is a real stack declaration and `alchemy plan --no-input` resolves it locally. This is the substrate seam: one desired state can later point at the local shop or a provider.                                                                                                          |
| **agentOS**              | **Adopt embedded Core**                                     | `@rivet-dev/agentos-core` runs the native sidecar in this process; no hosted endpoint or Rivet credential is needed. `AgentOs.create()` gives each room its own filesystem and processes. The `RoomProvider` seam keeps local worktrees as the host fallback. The remaining gap is the VM `network.preview` bridge.                   |
| **rivet-effect-cluster** | **Defer / reject for this milestone**                       | The package is experimental and peers on `effect ~4.1.4` (the repo has 4.1.5) plus `rivetkit ^3.1.2-rc.6` (not present). Adopting it would add a runtime and a cluster backend to solve concurrency that the existing journal, pass lock and lease already cover for two local workstreams. Revisit when durability crosses machines. |
| **rat-king**             | **Reject for this milestone; borrow the kernel vocabulary** | Pre-alpha, no running network or deploy automation, and no package to consume. Its useful vocabulary — Speaks, Remembers, Awakes, receipts, generation fences — already maps to the existing mailbox and journal. Adding it now would duplicate the seam.                                                                             |
| **talkto**               | **Reject for this milestone**                               | The linked project is a private Cloudflare-hosted app, not a library. The npm package named `talkto` is an unrelated 0.0.5 CLI. The existing desk plus board presence is the human/agent surface; a second chat surface is out of scope until the two-project launch works.                                                           |

## The seams this leaves

```text
room
  └─ RoomProvider
       ├─ local       worktree + process + leased port      today
       └─ agentOS     embedded VM · own filesystem/process   built in room

board
  ├─ journal + pass lock + lease      durable enough for two local workstreams
  ├─ Alchemy stack declaration        substrate seam, already installed
  └─ mailbox / intercom / desk        agent and human coordination

view
  └─ presence + factory status        one model, two renderings
```

The provider is an interface, not a dependency inversion of the protocol. The local
provider remains the fallback for host ports and previews. agentOS is embedded: the
native sidecar runs in this process, so no hosted endpoint or Rivet credential is required.

## Captured evidence

```text
$ cd packages/board && node -e 'import("alchemy")...'
{"keys":["ALCHEMY_DEV","ALCHEMY_PHASE",...],"stack":"function","localState":"function"}

$ cd packages/board && pnpm exec alchemy plan --no-input
[INFO] Plan · live_togmund
[INFO] Plan: no resources

$ cd /tmp/agentos-core-spike && node -e 'import("@rivet-dev/agentos-core")...'
keys: AgentOs, AgentOsSidecar, createSandboxFs, hostDirMount, ...

$ AgentOs.create(); writeFile("/tmp/hello.txt", "hello"); process.exec("cat /tmp/hello.txt")
CREATED object
RUN {"exitCode":0,"stdout":"hello\n","outcome":"succeeded"}
```

agentOS Core is now a `room` dependency (`@rivet-dev/agentos-core@0.4.9`). Its test creates
two VMs, writes a different `who.txt` into each, and proves `cat` and `exists` cannot see
the other filesystem. No hosted actor or credential is involved.

## Consequences

- `room` now owns an embedded agentOS VM per room. The remaining gap is the preview
  bridge: board still forwards host ports, while VM `network.preview` is the next slice.
- Durable concurrency is a board problem first: prove two workstreams across a daemon
  restart with the existing lease and pass lock before reaching for a cluster.
- Alchemy remains the adopted substrate dependency; agentOS is the embedded isolation
  dependency. Neither is a second deployment system.
- rat-king and talkto remain references. Their designs may inform the mailbox and desk,
  but they do not add surfaces in this milestone.
