---
"@autotelic/jig-cli": patch
---

Declare `typebox` for the pi extension, and prove both surfaces return the CLI's bytes.

`extensions/jig.ts` imports `typebox` at runtime, but the package declared neither it nor the
pi types, so the extension could not resolve its own import outside pi's host. `typebox` is now
a **dependency** (`1.3.34`), the placement the shipped-in-`files` extension needs. The pi types
stay undeclared on purpose — the import is `import type`, the extension is deliberately not
typechecked, and declaring the package would pull a large tree in for type-only use. `MIGRATION.md`
§6 now records that decision instead of leaving it open.

`src/surfaces.test.ts` closes the loop the brief asks for: it runs the real CLI in a temp repo,
then drives the pi extension (loaded by computed specifier) and the OpenCode plugin through fake
hosts, and asserts both hand back exactly the CLI's bytes — with a property over the formats
OpenCode offers. A second renderer, or a dropped byte, fails the test rather than a user's
session.
