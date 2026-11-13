---
"@autotelic/jig-cli": patch
---

The agent surfaces run the project's jig, and their tools can pass flags.

`jig_check` / `jig.check` preferred a `jig` on PATH over the repository's own install, so an
agent and CI could run different versions with nothing in the report saying which one answered.
The order is now project `node_modules/.bin/jig`, then PATH, then this package's build or
source; `JIG_BIN` still overrides all of it, and every result carries the chosen launcher
(`details.launcher` for pi, `metadata.launcher` for OpenCode).

Both surfaces also accept an `args` passthrough on `jig_check` and expose `jig_baseline`, so a
human-approved acceptance does not require leaving the tool surface. Judging still does:
`pi.exec` takes no environment, so a model key or an engine-only flag is a shell call, and
SECRETS.md now says so next to the host-environment contract.
