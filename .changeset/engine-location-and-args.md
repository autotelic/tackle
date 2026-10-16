---
"@autotelic/protocol": minor
"@autotelic/jig-cli": patch
---

`EngineRef` gains an optional `args`, and `jig` resolves an engine from the project.

A `jig.config.json` engine can now carry the arguments its invocation needs. `jig`'s `plumb`
engine uses it to scope `oxlint` with `--ignore-pattern`, so a root run never builds a
neighbouring repo's config (the exemplar's `.oxlintrc.json` names a plugin this workspace did
not import).

`jig` also looks for an engine's command in the project's own `node_modules/.bin` before it
falls back to PATH. The census therefore reports what the project installed, not what the
caller's shell happens to shadow — the workspace's `joggle` wins over a global install.
