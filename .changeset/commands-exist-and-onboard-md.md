---
"@autotelic/jig-cli": minor
---

`jig` grows the commands its README already named, and `init` writes `ONBOARD.md`.

The root README advertised `jig explain/learn/promote` while the CLI had only
`check/baseline/engines/init` — names without commands. All three now exist, as pure
functions of the one report (`src/commands.ts`) so each is checked by a test rather than by
running the world:

- `jig explain <engine/ruleId>` expands a rule's findings in this repo — message, `help`,
  `docsUrl`, and any `repair` — so `help` is a fix, not a restatement. It distinguishes the
  engine that is not configured from the engine that ran and said nothing.
- `jig promote` shows the ratchet's next rung: the accepted identities a run no longer
  earns. `--write` drops exactly those and refuses to accept new ones — the ratchet only
  ever shrinks; accepting is `jig baseline`, a human's decision.
- `jig learn` rewrites the agent cookbook from the rules the repo already accepts, so an
  agent can tell "new" from "known" without a second source.

`jig init` now also writes the onboarding prompt (`agent.onboarding`, default `ONBOARD.md`)
alongside the cookbook; both names are in the config schema and the exemplar, and the default
config declares both.
