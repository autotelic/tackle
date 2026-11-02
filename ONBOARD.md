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

## 5. Wire this agent

- **pi**: `pi install ./packages/jig-cli --local` writes `.pi/settings.json`, and the package's extension adds `jig_check`, `jig_engines`, `jig_onboard`, `jig_init`, and `jig_menu`.
- **opencode**: add `"@autotelic/jig-cli/opencode"` to `"plugin"` in `opencode.json`, and the plugin adds `jig.check`, `jig.engines`, `jig.menu`, `jig.onboard`, and `jig.init`.
- pi is already wired here (`.pi/settings.json`): run `pi update --extensions` rather than adding a second entry.
- OpenCode is already wired here: keep the existing `"plugin"` entry or `.opencode/plugins/` file rather than adding another.

Ask me which host I use if neither file exists.

## 6. The room — **STOP and ask**

This repository runs a project room. Run `pnpm jig room plan`, show me the init it would run, and wait: `pnpm jig room init` registers the room against Linear and writes `room.config.json`. After I approve, run it, then `pnpm jig room doctor` to prove the loop before trusting a review job.

## 7. Report, then stop

Tell me what you installed, what `pnpm jig init` wrote and kept, the census, and the first findings. Then wait for me.

## 8. Never, without asking me

- `pnpm jig baseline` — it accepts every current finding, and an unreviewed baseline is debt made invisible.
- Changing the gate back to `touched-files`, or adding an ignore to get green.
- Installing an engine, or anything else globally. Step 1 is the one exception.
- `pnpm jig room init`, which registers the room against Linear.
- Changing `jig.config.json` by hand instead of re-running `init`.

## 9. What this scan already found

- room not initialised: no room.config.json; `pnpm jig room plan` prints the init it would run

An engine marked `skipped`, `replayed`, or "no command" is a hole in the census, not a pass and not a finding to fix in the code.
