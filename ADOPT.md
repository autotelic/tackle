# ADOPT.md

> Paste this whole file into your coding agent at the root of **your** repository. It installs
> `jig` from the tackle source, points it at this repository, and hands over the ratchet.
> Nothing is applied until the agent runs it. If you were handed only the URL, the agent can
> fetch `https://raw.githubusercontent.com/autotelic/tackle/main/ADOPT.md` and work from that.

You are setting me up with `jig`, the conformance harness from tackle
(https://github.com/autotelic/tackle): every engine in one report, one baseline, and a gate that
fails on what is new. **This repository is not tackle** — tackle is where the tool comes from,
and the checkout lives beside my repository, not inside it.

Run the steps in order, running the commands yourself. Where a step says **STOP and ask**, stop
and wait for me.

## 1. Get the source and build it — **STOP and ask**

Nothing here is on the registry yet, so the CLI comes from a checkout. Confirm where to put it
with me, then:

```sh
git clone https://github.com/autotelic/tackle
cd tackle && pnpm install && pnpm -r build
```

`pnpm -r build` is not optional: the installed bin runs `dist/`, and an unbuilt checkout says
exactly that and exits. Node must be >= 24.18; if `pnpm` is missing, `corepack enable` first.

## 2. Put `jig` on this machine

```sh
pnpm add -g ./packages/jig-cli
jig --version
```

If `jig` is not found, the global bin directory is not on PATH: run `pnpm setup`, open a new
shell, and check again. The CLI is the one thing that belongs to the machine — the engines stay
devDependencies of my repository.

## 3. Point the engines at my repository — **STOP and ask**

`joggle`, `cutlist`, and `plumb` are not all published (and the published `plumb` predates the
fixes this checkout has), so link them from the same checkout into my repository's root:

```sh
cd <my repo>
pnpm add -Dw link:../tackle/packages/joggle link:../tackle/packages/cutlist \
  link:../tackle/packages/plumb link:../tackle/packages/jig-cli
pnpm add -Dw oxlint
```

Adjust the relative paths to where the checkout actually is. `-w` is required at a workspace
root. When these are published, this step becomes
`pnpm add -Dw @autotelic/jig-cli @autotelic/joggle @autotelic/cutlist @autotelic/plumb` and
step 1 disappears. If an install fails, read the error before retrying: a 404, a store mismatch,
and a missing `-w` are three different failures.

## 4. Initialise

```sh
jig init --gate all
```

It writes `jig.config.json`, `.jig-baseline.json`, `JIG.md`, `ONBOARD.md`, an engine ledger
where the config references one, and a starter `joggle.config.json` (with an architecture draft
when this is a workspace).

Then **stop and check `git status`**: if any of those paths is gitignored here, tell me. A
harness git cannot see gates this machine and nothing else — no CI, no reviewer, no second
machine — and that is a decision to make on purpose.

## 5. Read the census before the findings

```sh
jig engines
jig check --limit 20
```

An engine marked `skipped`, `replayed`, "candidates not judged", or a command that does not
resolve did not look: a note is never a pass. With no `TYPESAFE_API_KEY` the judged rules count
instead of judging, which is the honest state, not a failure.

For machine output use `pnpm exec jig` (or `jig`): `pnpm jig check --format json` puts pnpm's
own engine warning on stdout and corrupts the document.

## 6. Wire my agent host

- **pi**: `pi install <checkout>/packages/jig-cli --local`. The extension shells out to `jig`, so
  step 2 has to have worked; `pi list` should then show the package.
- **OpenCode**: add `"@autotelic/jig-cli/opencode"` to `"plugin"` in `opencode.json`. If that
  file denies tools wholesale, allow `jig.*` explicitly or the plugin's tools are invisible.

## 7. The room — only if I asked for one — **STOP and ask**

`jig room plan` first, and show me the init it would run. `jig room init` registers the room
against Linear, so it never runs without my approval; `jig room doctor` then names what this
machine is missing (`celld`, the `gh webhook` extension, a Linear token, `pi`).

## 8. Report, then stop

Tell me what you installed and where, what init wrote and kept, the census including what did not
run, and the first findings. Then wait for me.

## Never, without asking me

- `jig baseline` — it accepts every current finding, and an unreviewed baseline is debt made
  invisible.
- Turning a rule off, or adding an ignore, to get a run green.
- Installing anything globally, other than the `jig` CLI in step 2.
- `jig room init`.

## What "done" looks like

- `jig --version` prints a version, from the checkout you built.
- `jig engines` resolves every configured engine, or says which one is missing and why.
- `jig check` runs, and its census says what looked and what did not.
- `git status` shows the harness — or we decided on purpose that it is local-only.
- My agent host lists the jig tools, and their output is byte-equal to the CLI's.
