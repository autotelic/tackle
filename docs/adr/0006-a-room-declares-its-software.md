# ADR 0006 — a room declares its software, and the VM's report is the record

Status: accepted
Date: 2026-11-28

## Context

`createAgentOsRoom` (`packages/room/src/AgentOs.ts`) booted every VM with Core's default
software bundle and named nothing: `AgentOsOptions.software` (`agent-os.d.ts:410`) was unused,
and `defaultSoftware` (`:420`–`:425`) defaults to true. That bundle at
`@rivet-dev/agentos-core@0.4.9`, read from `dist/default-software/default-software.json`, is
`coreutils`, `sed`, `grep`, `gawk`, `findutils`, `diffutils`, `tar`, `gzip` — not one of
the tools a room's work needs. A Core release that changed the bundle would turn a pass into a
guest `command not found`, with nothing at boot to say so. That is cut 3 of
`docs/tech-seams.md` §3.

## The registry gap (what is actually installable)

A declaration is only as good as the release manifest it resolves against.
`https://releases.rivet.dev/agent-os/0.4.9/software/manifest.json` (read 2026-11-28) lists 29
artifacts: `acl`, `attr`, `browserbase`, `coreutils`, `curl`, `diffutils`, `duckdb`,
`envsubst`, `fd`, `file`, `findutils`, `gawk`, `git`, `grep`, `gzip`, `jq`, `ripgrep`,
`sed`, `sh`, `sqlite3`, `ssh`, `tar`, `tree`, `unzip`, `vim`, `wget`, `xfsprogs`, `yq`,
`zip`.

- `git` is published (17,961,114 bytes), so a room can declare it.
- `node` is not a software package at all: the guest's `node` is the sidecar's own JS runtime.
  `packages/room/test/vm-service.test.ts:135` spawns `node` in a VM booted with no declaration
  and it answers.
- `pnpm` is published by neither the default bundle nor the registry, so a room that needs it
  gets `command not found` in the guest. That is a gap in Core's registry; this cut cannot
  close it by naming a package the manifest does not have.

## Decision

1. The room boundary carries an explicit declaration in `room.json`
   (`packages/room/src/store.ts`), written by `room new` (or `--software`), and passed through
   as `AgentOsOptions.software` (`{ registry: name }` per entry) by `createAgentOsRoom`. A
   room file with no `software` field decodes to the empty declaration, so an older room is
   readable and starts offline.
2. The default declaration is **empty**, not `["git"]`. A registry package is downloaded on
   the host before `create` resolves, so defaulting to `git` would make every room boot depend
   on `releases.rivet.dev`: a new network requirement, and a test suite that fails offline.
   `--software git` is opt-in and fails honestly when the registry is unreachable.
   `defaultSoftware: false` remains a room-visible option for a bare VM.
3. At boot the supervisor records **the VM's own report** — `vm.software.installed()`, narrowed
   to `{ name, version, commands }` — in `room.json`'s `runtime.software`, beside the
   declaration and the derived `missing` list. There is no second manifest in this package: the
   installed set is always the runtime's answer, and `missing` is the declared name it does not
   list (`softwareReport` in `packages/room/src/VmSoftware.ts`). `installed()` reports packages
   the boot added, not Core's vendored bundle, so an empty default room reports `installed: []`;
   the record does not fill that in from a guess.
4. `missing` is recorded, not fatal. Failing the boot on it would make a name the registry does
   not publish (`pnpm`) a room that cannot start at all; the record is what makes the gap
   visible at boot instead of at the first command that needed it.

## Consequences

- A default room boots without the registry and records the Core bundle's own installed set. A
  room that declares `git` resolves it from the agentOS software registry, or from the mirror
  `AGENTOS_SOFTWARE_REGISTRY_URL` names, and that boot fails honestly when the registry is
  unreachable.
- The day the manifest publishes `node`/`pnpm`, naming them in a room declaration is a one-line
  change; `missing` stops naming them. They are not added to the default for the same network
  reason `git` is not.
- `room status` prints the installed set and any missing declaration; `room vm status --json`
  prints the boot record the supervisor wrote.
