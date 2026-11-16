---
"@autotelic/jig-cli": patch
---

The cookbook's stacked-branch recipe now gives the ordering rule, not just the scoped run:
accept and rebuild every branch first, then rebase bottom-up once, then push once. A commit on
the parent (an accepted identity, a rebuilt catalog) re-dirties every child above it, so a
cascade run between fixes runs once per fix — five times through a 22-branch migration.
