---
"@autotelic/joggle": patch
---

The published package now runs on a clean install. Two dependencies were missing from the
manifest while `dist` imports them: `@typescript/native` (statically imported by the type-fact
layer, so every command failed with `ERR_MODULE_NOT_FOUND`) and `@effect/platform-node-shared`
pinned beside `@effect/platform-node`, because that package declares `^4.0.5` for its own shared
module and a consumer install floated it to a newer minor, killing the tool on a `NodeWS` export.
Workspace `overrides` hid both; only a dependency reaches a consumer.

Verified by installing the packed tarball into an empty project and running `joggle cache
compact` on a real 20 MB ledger: 125,550 duplicates away, 20,515,807 -> 844,906 bytes.
