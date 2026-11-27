---
"@autotelic/joggle": minor
---

Canonical type ids are on by default again, with the walk memoised.

`typeIdOf` now reuses a project's earlier work by the checker's `Type.id`, by a
closed printed form (`string`, literals, object shapes built from them), by the
sub-encoding keyed on its parameter scope and cycle path, and by symbol for
declaration ids. The printed cache deliberately ignores bare names, because two
modules can print `User` for different interfaces. `DeclarationResult.typeIdWalks`
reports the walks and hits so a regression in reuse is visible.
