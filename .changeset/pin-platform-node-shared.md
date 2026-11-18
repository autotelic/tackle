---
"@autotelic/cutlist": patch
"@autotelic/jig-cli": patch
---

Pin `@effect/platform-node-shared` as a real dependency.

`@effect/platform-node` constrains its shared package with a caret and nothing else, so a
consumer whose lockfile resolves that caret upward got a shared package built for a newer
Effect than the one the tool pins: `cutlist@0.0.2` died on `effect/dist/process/CommandLine.js`
in a repository that also had Effect 4.1. The workspace `overrides` hid this locally; a
dependency is what publishes, and no package declared one. Both published tools now do, and
`scripts/check-catalog.mjs` now fails when a package uses `@effect/platform-node` without
pinning the shared package beside it, so the next tool cannot publish with the same gap.
