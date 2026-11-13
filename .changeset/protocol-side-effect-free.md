---
"@autotelic/protocol": patch
---

Declare the package side-effect free.

It is types, JSON Schema, and pure functions: importing from it cannot change program state, so
a bundler may drop what a consumer never uses. `sideEffects: false` is how a package says that;
without it every import is assumed live.
