# ONBOARD.md

You are working in tackle. This repository uses `jig` as its conformance
harness. Read this file, then `JIG.md`, then start.

This repo is both the product and the reference implementation: the tools are built _with_ the tools. Read this before changing a package.

## Do this first

1. Run `pnpm jig engines`. Confirm every configured engine resolves.
   **STOP and ask** before installing anything, and do not install a tool globally.
2. Run `pnpm jig check --limit 20`. Read the census before the findings: an
   engine marked `skipped`, `replayed`, or "candidates not judged" did not look at
   everything, and a note is not a pass.
3. Read `JIG.md` for the commands and the gate.

## The rules of the ratchet

- **Do not run `pnpm jig baseline` without asking.** It accepts every current
  finding, and a baseline accepted without review is debt made invisible.
- Fix findings in files you are already changing. Do not disable a rule to get green;
  if a rule is wrong for this repo, say so and ask before adding an ignore.
- Use `pnpm` for package scripts.
- The gate is `all`: every finding in the repository fails the run.

## What this repo configured

- package manager: pnpm
- engines: cutlist, plumb (oxlint.config.ts), plumb-plumb (packages/plumb/oxlint.config.ts), plumb-joggle (packages/joggle/oxlint.config.ts), joggle (joggle.config.json)
- plumb: oxlint.config.ts via `pnpm lint`
- typescript: yes
- gate: all
- baseline: .jig-baseline.json
- room not initialised: no room.config.json; `pnpm jig room plan` prints the init it would run

## The room

This repository runs a project room.

1. `pnpm jig room doctor` — prove the loop before trusting a review job.
2. `pnpm jig room board` — jobs, chits, and presence.

## When you need more

- `pnpm jig explain <rule>` — the rule's findings, help, and history here.
- `pnpm jig menu` — the component catalog, when cutlist is enabled.
- `pnpm jig --help` — every command.

## Stop and ask

- Before installing an engine, changing `jig.config.json`, or running
  `pnpm jig baseline`.
- Before changing the gate back to `touched-files`.
- Before `pnpm jig room init`: it registers the room against Linear and writes `room.config.json`.
- When a note says an engine could not run: that is a hole in the census, not a
  finding to fix in the code.
