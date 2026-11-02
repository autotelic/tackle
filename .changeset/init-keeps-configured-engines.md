---
"@autotelic/jig-cli": minor
---

`jig init` keeps the engines a repository already configured, reads a `cutlist.config.json`
where its engine scans, and documents the room.

A `--force` run used to rewrite `jig.config.json` from what detection found, which on a repo
that had grown a second `oxlint` config, a per-package `plumb`, or a `cutlist --cwd` engine
silently deleted those engines. Init now starts from the configured list: a repo's own entry
wins for the same id, detection adds what is missing, and an engine whose command no longer
resolves is dropped with a note instead of sitting in the plan looking enabled.

`cutlist`'s generated-artifact block follows the directory the engine scans, so a catalog
built under `examples/` is described from the repository root, and the summary names the
config it kept rather than reporting cutlist as absent. Repositories that ship or build a room
(`packages/room`, `@autotelic/room`, or a `room.config.json`) get `jig room` in `JIG.md` and
`ONBOARD.md`, plus a note pointing at `jig room plan` when no config exists yet.
