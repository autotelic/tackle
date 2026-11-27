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

1. The room boundary carries an explicit declaration — `software: { packages: ["git"] }` in
   `room.json` (`packages/room/src/store.ts`), written by `room new` (or `--software`), and
   passed through as `AgentOsOptions.software` (`{ registry: name }` per entry) by
   `createAgentOsRoom`. A room file with no `software` field decodes and means the default, so
   an older room is declared rather than bare.
2. `defaultSoftware: false` is a room-visible option: a bare VM still installs the declared
   packages, and `packages/room/test/vm-software.test.ts` proves `git --version` answers in
   one.
3. At boot the supervisor records **the VM's own report** — `vm.software.installed()`, narrowed
   to `{ name, version, commands }` — in `room.json`'s `runtime.software`, beside the
   declaration and the derived `missing` list. There is no second manifest in this package: the
   installed set is always the runtime's answer, and `missing` is the declared name it does not
   list (`softwareReport` in `packages/room/src/VmSoftware.ts`).
4. `missing` is recorded, not fatal. Failing the boot on it would make a name the registry does
   not publish (`pnpm`) a room that cannot start at all; the record is what makes the gap
   visible at boot instead of at the first command that needed it.

## Consequences

- A room VM boot now resolves `git` from the agentOS software registry, or from the mirror
  `AGENTOS_SOFTWARE_REGISTRY_URL` names. The test that proves it needs that registry: `git`
  being published there is the requirement, and skipping the test would be a green run that
  looked at nothing.
- The day the manifest publishes `node`/`pnpm`, the names go in
  `packages/room/src/VmSoftware.ts`'s `defaultRoomSoftware` — one place — and `missing` stops
  naming them.
- `room status` prints the installed set and any missing declaration; `room vm status --json`
  prints the boot record the supervisor wrote.
