---
"@autotelic/room": minor
"@autotelic/jig-cli": minor
---

`jig room doctor` names a missing `pi`, and onboarding says what the room needs on a machine.

Both halves of the loop run `pi`: the review job spawns it, and the wake resumes the project
session with it. A machine without it looked healthy until the first event nobody answered, so
doctor now checks it beside `celld` and names the consequence. `doctor` also takes an optional
PATH lookup, which is how the check is tested without pretending to be a different machine.

The generated `ONBOARD.md` grows a real room sequence instead of a single paragraph: `plan`,
`init` after approval, `doctor`, then `dev`, `webhook | sh`, and `daemon` — with the checks
doctor can name spelled out (`celld`, the `gh webhook` extension, a Linear token, `pi`) and the
reminder that `hc` is only for `room work`. `JIG.md`'s room section gains the commands it was
missing and points at `jig room doctor` rather than keeping a prerequisite list that goes stale.
