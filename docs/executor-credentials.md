# Executor credentials

The executor is the factory's account gateway. A repository declares the accounts its work
needs; the executor holds the values, grants only the declared accounts to a workstream, and
mints a short-lived lease a VM can use. Secrets never enter a repository, a workstream record,
or a rendered list.

## The repository manifest

A repository commits `.factory/credentials.json`:

```json
{
  "version": 1,
  "mode": "advisory",
  "credentials": [
    {
      "id": "github",
      "kind": "github",
      "env": ["GH_TOKEN"],
      "reason": "read pull requests and CI"
    },
    {
      "id": "opencode",
      "kind": "opencode",
      "env": ["OPENCODE_API_KEY"],
      "reason": "run the worker model"
    },
    {
      "id": "browse",
      "kind": "mcp",
      "env": ["BROWSE_MCP_URL", "BROWSE_MCP_TOKEN"],
      "reason": "capture the handoff screenshots"
    },
    {
      "id": "traces",
      "kind": "observability",
      "env": ["TRACE_QUERY_URL", "TRACE_QUERY_TOKEN"],
      "reason": "let the agent query this environment's traces"
    }
  ]
}
```

`env` names the variables the tool reads. `reason` is what a person sees when the account is
missing. `kind` is a hint for the setup card, not an authority decision.

`mode` is the rollout switch:

- `advisory` (the default when omitted) publishes the card, records grants, and leaves the
  existing host environment unchanged. Missing accounts do not fail a pass.
- `enforce` makes the manifest the only grant list: missing required accounts refuse the pass
  before it starts, and unmanaged host secrets are filtered from the worker.

Start every repository in advisory, configure its accounts, then flip to enforce as its own
commit. A repository with no manifest keeps the host-environment mode.

## Store the accounts once

Values come from the host environment and are written to `~/.factory/executor/credentials.json`
with mode 0600. The command prints variable names, never values.

```sh
GH_TOKEN=... factory credentials set --id github --kind github --env GH_TOKEN
OPENCODE_API_KEY=... factory credentials set --id opencode --kind opencode --env OPENCODE_API_KEY
```

An account can hold several variables, which is how an MCP account usually arrives. If two
granted accounts set the same variable to different values, resolution fails instead of picking
one by object order.

## The setup card

```sh
factory credentials check --path .
```

This prints one row per declared account and its state (`ready` or `MISSING <variables>`), and
exits 1 while a required account is missing. `required: false` declares an optional account; it
is still listed, but does not block the pass.

## Grants and leases

`factory executor prepare --id <workstream>` reads the repository manifest from the workstream
path and replaces that workstream's grants with exactly the declared accounts. In `enforce`, a
missing required account refuses the pass before it is charged and before a worker starts; in
`advisory` it only reports the gap.

```sh
factory grant list --workstream <id>
factory executor prepare --id <id>
factory executor lease --id <id> --ttl 600 --out /tmp/lease.json
```

The lease is written 0600 and contains the resolved environment plus the account ids and expiry.
The default lease path is `~/.factory/executor/leases/<workstream>.json`; the command prints it.

## Giving a VM the lease

```sh
room vm --id <room> --executor-lease /tmp/lease.json -- sh -c 'gh pr view 42'
```

The room reads the lease before creating the VM, refuses a malformed or expired lease, and
passes the variables to that one command. The host environment is never forwarded. The guest
also gets `EXECUTOR_WORKSTREAM` and `EXECUTOR_EXPIRES_AT`, but not the lease file path.

## Factory workers

When a repository has a manifest, a factory pass receives only the accounts prepared from that
manifest. The rest of the host environment is stripped of secret-looking names (`*_TOKEN`,
`*_API_KEY`, `*_SECRET`, `DATABASE_URL`, and similar) while paths, locale, home, and the
harness's own controls remain. A repository without a manifest keeps the previous host
environment until it opts in.

## Federation

Credentials belong to the machine that holds them. A lease is the unit another machine may be
asked for, and it expires; a raw secret never crosses the tailnet in a record or a PR. The
next slice is a tailnet executor endpoint that mints the same lease for an authenticated peer,
so a remote factory can request a capability without copying the store.
