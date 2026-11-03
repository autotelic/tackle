---
name: feedback-loop
description: Have a second session try to break your work in a real repository. Use when a change needs checking instead of believing.
---

Tell the tester the commit, the first command, and what counts as success — never what you expect
it to find.

**Tester owes**: the command it ran and the output it got. "The onboarding is wrong" is not a
finding; `jig init --hooks` printing `foreign` when the hook exists is.

**Builder owes**: which commit, and which gate is green — the command and its exit status, not a
claim. Fix defects; argue disagreements in the same message, with the reason. Never reopen a
finding whose sha has moved without saying so.
