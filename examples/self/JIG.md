# JIG.md

The agents you run here get the same findings a human's terminal does — one report, one
vocabulary. Reach for these instead of re-deriving them:

- `jig check` — run every engine, one oxlint-shaped report, fail on what is new.
- `jig baseline` — accept the current findings; the ledger only shrinks after that.

Grounded rules come from the vocabulary `cutlist` builds (the UI catalog and menu); prefer
the components the menu already lists over new ones.
