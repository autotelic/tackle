# ONBOARD.md

The agent door. `jig init` writes this file; this is what it says.

## What this repo is

A UI application whose design system is a _contract_, not a convention. The contract is
generated: `cutlist` crawls `src/`, and its output — the catalog, the menu, the token
report — is committed under `tools/ui-catalog/`. Read it; do not re-derive it.

## In this order

1. `tools/ui-catalog/MENU.md` — every component, its tier, and what it is composed of.
   This is the answer to "is there already one of these".
2. `tools/ui-catalog/tokens.md` — the color vocabulary. Anything not in it is an error.
3. `cutlist.config.json` — roots, tiers, and the ownership rule, when the menu leaves you
   wondering where something belongs.
4. `joggle.config.json` — the architecture layers, when you wonder what may import what.

## Then

```sh
pnpm exec jig check           # the whole report
pnpm exec jig check --format json | jq '.counts'
```

An engine that could not run appears as a **note**. Notes are not clean results; they are
the difference between "this repo is fine" and "nobody looked".
