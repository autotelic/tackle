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

## In the report

A missing key is never silence. `joggle` reports the unjudged candidates as `not judged`, and
the merged report carries that census — an unjudged engine is "not looked at", never "clean".
