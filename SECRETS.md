# Secrets

> One decision, recorded once. Every tool in this workspace reads a secret the same way; this
> file says what that way is, why the host owns it, and what is deliberately not built.

## The contract

**The process environment is the interface.** A judged engine reads its key from the
environment it was started with, and nothing below the host fetches a secret:

- `joggle` reads `TYPESAFE_API_KEY` through Effect `Config` and steps aside when it is absent.
- `jig` passes its own environment through to every engine it spawns. It never reads, stores,
  or names a secret.
- The two agent surfaces — `packages/jig-cli/src/opencode.ts` and
  `packages/jig-cli/extensions/jig.ts` — spawn `jig`, which inherits their environment in turn.

That is the whole mechanism. `jig check` and `jig_check` produce the same bytes because they
reach the same engine the same way; a secret that reached only one of them would be the second
answer this workspace exists to prevent.

## The portable default: judge once, replay everywhere

Reviewed verdicts are committed under `.joggle/answers/`, sharded and keyed. A run with no key
replays them:

```sh
joggle check --offline     # no key, no tokens, same verdicts
jig check                  # replays the same committed answers
```

**This is the answer for CI and for anyone who clones the repository.** No secret, no Doppler,
no setup. The judged rules only need a key when they must answer a _new or changed_ candidate,
which is a maintainer's job, not a contributor's or a CI runner's.

## Judging locally: launch the host under a manager

When a maintainer does need new verdicts, the key must be in the environment of the process
that **started the agent host**, not merely in the shell that types the command:

```sh
doppler run -p joggle -c dev -- opencode      # OpenCode
doppler run -p joggle -c dev -- pi            # pi
# or any equivalent: op run -- …, direnv (auto on cd), node --env-file=.env.local …
```

OpenCode's shared background service is the wrinkle: the plugin runs _in the service_, so a
wrapper around the TUI is not enough unless the service is restarted under it
(`doppler run … -- opencode service restart`) or the run is standalone (`opencode --standalone`).
pi has no such split; `pi` and its `pi.exec` children inherit one environment.

Doppler is the manager this repository happens to use. It is not part of the design: any
launcher that populates the environment works, and none of them is a code dependency.

## Two layers: a personal config and the repository's

A maintainer often runs two: a personal project holding the model key, and the repository's
own project holding whatever the repo needs. They compose by nesting the launcher, and the
nesting is not symmetric — `doppler run` resolves a project from the **working directory's**
`doppler.yaml`, and that beats `--project`/`--config` _and_ `DOPPLER_PROJECT`/`DOPPLER_CONFIG`
in the environment. A bare `doppler run` from inside a repository therefore enters the
repository's layer, whatever the outer one was.

```sh
# personal layer outside, repository layer entered from the repository root
cd ~/personal && doppler run -p personal -c dev -- \
  sh -c 'cd "$1" && exec doppler run -p tackle -c dev -- pi' _ ~/autotelic/tackle
```

Four rules follow from that:

- **Enter each layer from its own root.** `cd` into the layer's directory rather than trusting
  a flag to win; the working directory is what Doppler reads.
- **The inner layer's identity shadows the outer one's.** `DOPPLER_PROJECT`, `DOPPLER_CONFIG`
  and `DOPPLER_ENVIRONMENT` describe the innermost run, so name the layers in the launcher,
  never in the environment.
- **`HOME` has to survive.** Doppler finds its own auth there. pi spawns children without a
  login shell and has handed over an environment without `HOME`; jig's pi extension puts it
  back before it spawns anything, and a launcher the agent runs needs the same guarantee.
- **Two layers are still one environment by the time `jig` runs.** `jig` reads no secret and
  starts no manager: it inherits, and both agent surfaces inherit from it in turn. A run that
  needs a key it was not started with says `not judged`; that sentence is the check, and it
  never prints a value.

## Why the environment, and not a tool-side loader

The two hosts do not offer the same conveniences:

|                                            | OpenCode                                         | pi                                                                       |
| ------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------ |
| Host environment reaches the surface       | yes                                              | yes                                                                      |
| Surface → child env                        | `execFile` inherits                              | `spawn` inherits                                                         |
| Config-substituted secret into the surface | yes — plugin `options` with `{env:}` / `{file:}` | **no** — extensions have no options object, and `pi.exec` takes no `env` |
| Host-native "spawn with env" shape         | MCP `environment`                                | MCP `env`                                                                |
| Host-native "read a secret" shape          | MCP `headers` / `environment`                    | provider `apiKey: "$ENV"` or `"!command"`                                |

A solution built on OpenCode's `{file:}` substitution into plugin options would work for
`jig_check` in OpenCode and not in pi. Two hosts, two answers. The environment is the one
mechanism both hosts already honour, so it is the contract; the OpenCode options are a
convenience on top, never the foundation.

## Deliberately not built

- **No `.env.local` loader in `jig`.** A tool that reads a secret file is a tool with an opinion
  about where secrets live, and it silently diverges from the host in every client repository.
  The host owns the environment; the tool owns the interface.
- **No `joggle` PATH shim.** A wrapper binary that injects a key is invisible, per-machine, and
  the reason a fresh checkout "does not judge". Put the key in the host's environment instead.
- **No secret in any config file.** `.jig.config.json`, `joggle.config.json`, and
  `opencode.json` name the _variable_, never the value.

## The agent tools spawn jig; they do not judge

`jig_check` and `jig.check` run `jig` in the environment the host gave the surface, and
`pi.exec` takes no `env` argument. So a run that needs a key the host was not started with
cannot be produced from the tool surface: the engine sees no key and reports "not judged".
That is the contract working, not a bug. To judge:

1. Start the host under the manager (the recipes above), and
2. run the judged command in a shell.

The tools accept `args` for jig's own flags, and each result names the launcher it used
(`details.launcher` for pi, `metadata.launcher` for OpenCode) — the project's pinned
`node_modules/.bin/jig` first, then `PATH`, then the package's build — so a report can be
traced to the code that produced it. Engine-only flags (`--rule`, `--max-tokens`,
`--update-baseline`) are also shell-only: `jig` does not forward them, and a baseline written
without judgement is the thing `--allow-unjudged-baseline` exists to make explicit.

## In the report

A missing key is never silence. `joggle` reports the unjudged candidates as `not judged`, and
the merged report carries that census — an unjudged engine is "not looked at", never "clean".
