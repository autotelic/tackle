---
name: feedback-loop
description: Run a builder and a tester against one real repository so claims are checked instead of believed. Use when shipping a tool change that needs adversarial verification, when a second agent should try to break your work, or when you are the tester and must report findings a builder can act on.
---

# Feedback loop

One session writes; another session tries to make it fail, in a different terminal, on a real
repository. The value is not politeness — it is that **the tester can only report what it ran.**

## Split the roles

- **Builder**: writes the change, runs the repository's gates, pushes a branch.
- **Tester**: gets the branch and a real adopter repo, installs the CLI, and tries to break it.

Tell the tester the exact commit, the command it should run first, and what would count as
success. Do not tell it what you expect to find; that turns a test into a confirmation.

## What the tester owes

- Every finding names **the command it ran and the output it got**. "The onboarding is wrong" is
  not a finding; `jig init --hooks` printing `foreign` when `.git/hooks/pre-commit` exists is.
- Distinguish **defect** from **disagreement**: one is a bug, the other is a design opinion.
- Probe with the smallest possible input — a throwaway repository in `/tmp`, one PR, one file.
- Report a defect even when it is outside the part that changed; that is where it will hurt.

## What the builder owes

- Fix what is a defect; argue what is a disagreement, in the same message, with the reason.
- When the fix is in, say which commit and which gate is green — `jig check`, `pnpm check`, and
  the test count, not a claim about them.
- Never re-litigate settled work because a message arrived late: check the sha the finding was
  written against before reopening it.

## The loop, concretely

```sh
jig check --gate touched-files   # builder: only the change in front of you
jig check                        # tester: the whole tree, on the adopter repo
```

A quiet run is only clean if it looked: read the report's census, and treat a note ("an engine did
not run") as _not looked at_, not as _clean_.
