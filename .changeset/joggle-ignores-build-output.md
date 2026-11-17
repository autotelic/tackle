---
"@autotelic/joggle": patch
---

A checker-discovered file list now drops build output, the same way the directory walk always
has. `--types` takes the file list from the checker, and a tsconfig's include is not a judgement
about what is source: with `packages/*/dist` in the program, every declaration was analysed twice
— once as written, once as built — and reported as "declared in two places". On one repository
73 of 95 findings were that, and the count depended on whether the developer had ever run a build.
