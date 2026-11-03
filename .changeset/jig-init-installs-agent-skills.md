---
"@autotelic/jig-cli": minor
---

`jig init --skills` installs the three agent skills a room-based workflow needs.

Setup was the same three manual steps in every repository — install intercom, name the sessions,
remember which command resumes a room — and every one of them was a place to get it wrong. A skill
is instructions a host loads on demand, so the setup belongs with the harness instead:

- `room` — open, join, and resume a room; `jig room resume` is the diff, and its `cursor lost`
  line is what a cold start honestly says.
- `intercom-setup` — install pi-intercom once, alias each session, and **check `intercom list`
  before the first real message**: a send to a peer that is not listed looks successful and
  arrives nowhere, which is the failure this skill exists to prevent.
- `feedback-loop` — a builder and a tester on one real repository: what the tester owes (the
  command it ran and the output it got), and what the builder owes (which commit, which gate).

The skills live in `packages/jig-cli/skills/` and are declared as `pi.skills`, so
`pi install @autotelic/jig-cli` provides them globally; `--skills` copies them into
`.agents/skills/`, the one directory pi and OpenCode both discover. Content is compared, not
timestamps: a re-run reports `kept` and writes nothing, and `--print` reports `would write`
without touching the tree.
