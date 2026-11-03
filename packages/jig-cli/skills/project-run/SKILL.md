---
name: project-run
description: Run one workstream from a GitHub label and a Linear project to merged pull requests. Use when a session starts with a label and a project rather than a task.
---

Inputs: this repository, a GitHub label, a Linear project.

1. **Room.** `jig room plan`, then `jig room daemon` (own terminal) and `jig room session`.
2. **Work.** The label is the queue; the project is the plan.
   `gh issue list --label "<label>" --state open`
   `linearis issues list --limit 100` — filter to the project's name.
   Take one item, implement it, open a PR that closes it. One item at a time.
3. **Watch.** After each push:
   `gh pr checks --watch` for CI, `jig room resume --apply` for reviews and inline notes.
   Rerun the repository's own gate before pushing, and never report a green you did not see.
4. **Report.** Tell a `tackle` session what the tooling did wrong — not what you did:
   `intercom({ action: "list" })`. If no tackle session is listed, start one in the tackle
   checkout (`pi`, then `/alias tackle`), list again, and send the command and its output.
