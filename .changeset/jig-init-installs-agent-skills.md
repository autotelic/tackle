---
"@autotelic/jig-cli": minor
---

`jig init` installs four small agent skills beside the config and the docs.

Setting up a room-and-reviewer workflow was three manual steps in every repository — install
intercom, name the sessions, remember the resume command — and every step was a place to get it
wrong. A skill is instructions a host loads on demand, so it ships with the harness:

- `room` (14 lines) — plan, daemon, session, resume; `cursor lost` and "a card written at an older
  sha is a question, not an instruction".
- `intercom-setup` (20) — install once, alias each session, and **list before you send**: a peer
  that is not listed receives nothing and the send still looks successful.
- `feedback-loop` (14) — a builder and a tester on a real repository: the tester owes the command
  and its output, the builder owes the commit and the gate.
- `project-run` (18) — a GitHub label plus a Linear project as the whole brief: open the room, take
  one item, watch `gh pr checks --watch` and `jig room resume`, and report to a tackle session,
  starting one in the tackle checkout when none is listed.

They are files under `.agents/skills/` — the one directory pi and OpenCode both discover — so init
writes them like any other harness file, and the onboarding prompt says so in the step that already
runs `jig init`. A skill someone edits is kept and reported; `--force` replaces it.
