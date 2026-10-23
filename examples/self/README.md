# examples/self

An exemplar **client** repository: the config set every adopter writes, kept runnable so
the tools are exercised against a real tree instead of a fixture.

It is a workspace package (`examples-self`, private) for exactly one reason — the
`examples/*` glob in `pnpm-workspace.yaml` has to resolve something — and it is **not**
built, typechecked, or published. `.changeset/config.json` ignores `examples-*`, and its
`package.json` declares **no scripts at all**, so no `pnpm -r run …` can reach it (its own
`check` would fail here: the `plumb` plugin this repo points at is not installed in the
toolbox workspace). It does link the tools it points at, so `pnpm exec cutlist` and
`pnpm exec jig` work from this directory.

A real client would wire those into scripts; here they are deliberately left out so the
exemplar cannot be mistaken for a workspace package that owns a gate.

## What it demonstrates

Each tool keeps its own config, so a client can adopt one without the others:

| File                  | Owner         | What it declares                                              |
| --------------------- | ------------- | ------------------------------------------------------------- |
| `cutlist.config.json` | cutlist       | roots, tiers, token source, ownership, patterns, output paths |
| `jig.config.json`     | jig           | which engines are active, and how a run is gated              |
| `joggle.config.json`  | joggle        | presets, rule levels, architecture layers                     |
| `.oxlintrc.json`      | oxlint        | plumb and plumb-ui as `jsPlugins`                             |
| `.oxlint-errors.json` | oxlint-action | the touched-files error gate                                  |

`cutlist.config.json` is the load-bearing one: it is the _vocabulary_ every other file
repeats. `src/` is a small app whose tiers fall out of that vocabulary rather than out of
a convention — read `tools/ui-catalog/MENU.md` after a build and you can see the
ownership decision (`dashboard_.$id` and `dashboard_.$id.sponsors` are one domain, not
two) doing its work.

`src/components/ui/badge.tsx` is an **orphan** on purpose: nothing imports it. An unused
primitive is the cheapest kind of duplicate to have, so the catalog says so rather than
leaving a reader to notice.

## Running it

`tools/ui-catalog/` is generated and committed, exactly as a client would commit it, so
`cutlist --check` can tell "the tree moved and the catalog did not" from "the catalog is
current":

```sh
pnpm cutlist build --cwd examples/self          # from the workspace root
pnpm cutlist build --check --cwd examples/self  # the staleness gate (model-based)
pnpm jig engines --cwd examples/self            # the census: what is configured, what is installed
```

(The generator owns its bytes and the artifact is in `oxfmt`'s `ignorePatterns`, so `build`
is idempotent and there is no separate format step. Authored intent lives in
`tools/ui-intent/`.)

`jig check` here lists the whole family, including engines this workspace has not moved in
yet. Nothing about that is silent, and the two shapes mean different things:

- **A missing binary is a note.** `cutlist could not run: NotFound: ChildProcess.spawn` — the
  census saying _not looked at_, and it does not fail the run.
- **Output jig cannot read is a finding.** `plumb/unparsed-output` with the failing text as
  its `help` — an engine that ran and did not speak the protocol, which does fail the run.

Neither is "clean". That distinction is the whole point of the report, so run it here and
read it rather than trusting the exit code.
