# JIG.md

The conformance harness for tackle. `jig` runs the engines this repo
configures, merges their output into one report, and holds the ratchet: a run fails
on new findings, not on debt this repo has already accepted.

This repo is both the product and the reference implementation: the tools are built _with_ the tools. Read this before changing a package.

## Commands

| Command                     | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `pnpm jig check`            | every engine, one report, fail on what is new                   |
| `pnpm jig check --limit 50` | the census and the first 50 findings                            |
| `pnpm jig engines`          | what is configured, and whether each command resolves           |
| `pnpm jig baseline`         | accept the current findings; the ledger only shrinks after that |
| `pnpm jig explain <rule>`   | everything jig knows about one rule, here, now                  |
| `pnpm jig room board`       | the room: jobs, chits, and presence                             |
| `pnpm jig menu`             | the component catalog cutlist built                             |

## The repo's own commands

- `pnpm lint` — the repo's lint script
- `pnpm typecheck` — the repo's typecheck script
- `pnpm test` — the repo's test script
- `pnpm format` — the repo's format script
- `pnpm check` — the repo's check script

## What runs

- engines: cutlist, plumb (oxlint.config.ts), plumb-plumb (packages/plumb/oxlint.config.ts), plumb-joggle (packages/joggle/oxlint.config.ts), joggle (joggle.config.json)
- gate: `all`, failing on `any-new` identity
- baseline: `.jig-baseline.json`

Notes:

- room not initialised: no room.config.json; `pnpm jig room plan` prints the init it would run

## The room

`jig room` is this repo's listener: one ledger per Linear project, a daemon on each
machine, and a review job that runs `pnpm jig`, a Pi, and one fenced post.

- `pnpm jig room plan` — read the repo, the token, and the rooms; print the init it would run
- `pnpm jig room init` — write `room.config.json` and register the room
- `pnpm jig room doctor` — prove the loop: config, identity, celld, webhook, room
- `pnpm jig room board` — jobs, chits, and presence

Every finding in the repository fails a run. Accept the current debt deliberately
with `pnpm jig baseline`, or switch the gate to `touched-files`.

## CI

Run `pnpm jig check --format github` in the pull-request workflow. The gate holds new identities only, so the first run explains the debt instead of failing on it.

## Judgement

joggle judges candidates with the TypeSafe model. No TYPESAFE_API_KEY is present in this environment, so unjudged candidates are counted, not printed. Set the key to judge, or keep the count in CI.

## Reading a finding

A finding is a place, a sentence, and a rule id. `pnpm jig explain <rule>` shows
the rule's findings here, the help text, and whether it is one you can fix now.

A **note** on an engine means "not looked at": a missing command, a skipped rule, or
candidates the model did not judge. It is never "clean".

## The one rule

Do not run `pnpm jig baseline` to make a run green without reading what it
accepts. The baseline is a reviewed ledger, not a mute button.
