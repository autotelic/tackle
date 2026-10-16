# Working in this repo

This is a client repo in the `tackle` sense: the tools are pointed at _this_ code, and its
vocabulary lives in `cutlist.config.json`. Read that file before adding a component — it
is the answer to "where does this go", and guessing produces a finding.

## The rules that actually bind

- **Compose, do not re-render.** Before writing a component, check `tools/ui-catalog/MENU.md`
  for one that already does it. `plumb-ui/no-local-copy-of-shared` reads the same catalog
  and fails a second copy of a shared signature.
- **A primitive is the only place raw HTML is legal.** `src/components/ui/**` is allowlisted
  in `.oxlintrc.json`; everywhere else `plumb-ui/no-raw-html-layout` and
  `no-raw-interactive` apply.
- **Colors are tokens, never literals.** `bg-gray-500` and `bg-[#fff]` are both
  `plumb-ui/no-off-token-color`. The vocabulary is in `src/styles/app.css`.
- **Tiers are computed, not chosen.** `components/ui` → primitive, two owners → shared, one
  owner → local. `plumb-ui/no-misplaced-local` is the reviewer for that decision.
- **A context is three files** — the context, the provider, the hook — so the provider and
  the hook never depend on each other (`plumb-react/require-tripartite-context`).

## Before you call it done

```sh
pnpm exec jig check     # every engine, one report, one vocabulary
```

A **note** in that report means an engine did not run; it never means "clean". If you add a
component, regenerate the catalog (`cutlist build`) in the same change — a stale catalog is
a failing gate, not a warning.
