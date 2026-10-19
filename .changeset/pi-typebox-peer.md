---
"@autotelic/jig-cli": patch
---

Declare `typebox` as a pi host-provided peer, not a dependency.

pi 1.2 provides `typebox` to extensions as a host module and refuses to treat it as a
bundled dependency, warning that an installed copy can bypass the extension loader and
duplicate the runtime module. Dogfooding the extension in this repo surfaced the warning:
`typebox` moves from `dependencies` to `peerDependencies` with a `"*"` range (a pinned
`devDependency` keeps the monorepo's `surfaces.test.ts` resolvable). The earlier decision
to ship it as a dependency, recorded in `MIGRATION.md` §6, is updated.
