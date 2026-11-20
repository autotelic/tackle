---
"@autotelic/joggle": patch
---

Share protocol's severity ranking instead of keeping a second copy.

Re-judging this workspace after treadle joined reported `joggle/duplicate-meaning`:
`rank` in joggle's report duplicated `severityRank` in protocol, the package that owns the
report format. Joggle now depends on `@autotelic/protocol` — the direction the dependency law
already names — and sorts with the one ranking, so a severity ordering cannot drift between the
format and a consumer.
