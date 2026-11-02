# ONBOARD.md

> Paste this whole file into your coding agent at the root of `tackle`. It sets the
> harness up end to end; nothing here is applied until the agent runs it.

Set `tackle` up with `jig`, the conformance harness this repository configures: every
engine in one report, and a gate that fails on what is new.

This repo is both the product and the reference implementation: the tools are built _with_ the tools. Read this before changing a package.

Run the steps in order, running the commands yourself. When a step says **STOP and ask**,
stop and wait for me.

## 1. Put `jig` on this machine

The CLI is the one thing that belongs to the machine rather than the repository.

```sh
pnpm add -g ./packages/jig-cli
jig --version
```

If `jig` is not found, the global bin directory is not on PATH: run `pnpm setup` (it puts `pnpm bin -g` on PATH), open a new shell, and try again.

`./packages/jig-cli` is this checkout: run step 1 again after a build that changes the CLI.

If the install itself fails with a 404, the package is not on the registry yet: ask me for a checkout and link it instead (`pnpm add -D -w link:<checkout>/packages/jig-cli`), then point pi at the linked copy (`pi install ./node_modules/@autotelic/jig-cli --local`) — an unpublished name is treated as a relative path.

## 2. Read what this repository already decided

- `JIG.md` — the commands, the gate, and what a note means. Read it before you run anything.
- `jig.config.json` — engines: cutlist, plumb (oxlint.config.ts), plumb-plumb (packages/plumb/oxlint.config.ts), plumb-joggle (packages/joggle/oxlint.config.ts), joggle (joggle.config.json); gate: `all`; baseline: `.jig-baseline.json`.
- `AGENTS.md` — how this repository wants to be worked in.

Then run `pnpm jig engines` and confirm every configured engine resolves.

## 3. Install what is missing — **STOP and ask**

Engines are devDependencies here, never global installs: `pnpm add -D <package>`, then `pnpm jig engines` again. Before you install anything, tell me the engine, the package, and what the census says is missing.

## 4. Initialise, then read the census

`jig.config.json` is already here, and nothing needs applying: a re-run keeps it. `pnpm jig init --gate all --force` rewrites the config and the two docs — never the baseline — so run that only when the plan changes.

Then `pnpm jig check --limit 20`: read the census before the findings. An engine marked `skipped`, `replayed`, or "candidates not judged" did not look, and a note is never a pass.

Secrets are the environment and the host owns them: if a run needs a key this session was not started with, say so and stop. Never add a loader, and never nest a second `doppler run` from this directory -- it resolves the project from the working directory's `doppler.yaml`, so the layer you think you added is not the one that wins.

## 5. Commit it, or say it is local-only — **STOP and ask**

`git status` after init: the harness is config, two docs, a ledger, and a generated block. If any of them is _ignored_ here, stop and tell me, because a harness git cannot see gates this machine and nothing else — no CI, no reviewer, no second machine. Do not edit `.gitignore` without asking; the baseline and the gate are worth nothing to anyone who cannot check out the record.

## 6. Wire this agent

- **pi** is already wired here (`.pi/settings.json`): run `pi update --extensions` rather than adding a second entry.
- **OpenCode** is already wired here: keep the existing `"plugin"` entry or `.opencode/plugins/` file rather than adding another.

## 7. The room — **STOP and ask**

This repository keeps a project room: one ledger per Linear project, a daemon on this
machine, and a review job that runs jig, a Pi, and one fenced post.

```sh
pnpm jig room plan            # read it, then show me the init line and wait
pnpm jig room init            # only after I approve: writes room.config.json, registers the room
pnpm jig room doctor          # names what is missing on this machine
pnpm jig room dev             # the room, locally
pnpm jig room webhook | sh    # forward GitHub events to it
pnpm jig room daemon          # its own terminal: claims jobs, wakes the session
```

Ask before installing anything doctor names. What the checks mean:

- `celld` — the room itself: `curl -fsSL https://celld.dev/install.sh | sh`
- `gh webhook` — the GitHub forward: `gh extension install cli/gh-webhook`
- a Linear token at `~/.linearis/token` (`linearis`), when this room watches Linear
- `pi` — the review and the session wake both run it, so it has to be on PATH

`hc` (herdr-core) is only needed by `pnpm jig room work`, and the wake needs the machine
awake: a sleeping laptop is a hosting problem, not a bug.

## 8. Report, then stop

Tell me what you installed, what `pnpm jig init` wrote and kept, the census, and the first findings. Then wait for me.

## 9. Never, without asking me

- `pnpm jig baseline` — it accepts every current finding, and an unreviewed baseline is debt made invisible.
- Changing the gate back to `touched-files`, or adding an ignore to get green.
- Installing an engine, or anything else globally. Step 1 is the one exception.
- `pnpm jig room init`, which registers the room against Linear.
- Changing `jig.config.json` by hand instead of re-running `init`.

## 10. What this scan already found

- room not initialised: no room.config.json; `pnpm jig room plan` prints the init it would run

An engine marked `skipped`, `replayed`, or "no command" is a hole in the census, not a pass and not a finding to fix in the code.
