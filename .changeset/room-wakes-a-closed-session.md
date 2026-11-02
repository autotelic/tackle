---
"@autotelic/room": patch
---

`roomd` now resumes the session it is supposed to.

The README and the commit that added it both said the daemon wakes a session whose heartbeat
had gone stale. The check was inverted, so the opposite happened: a closed session was never
resumed, and an open one got a second `pi -p --session` writer in the same transcript.
`shouldWake` states the rule in one place — a known id and a stale heartbeat — and the
extension keeps owning the inbox while a session is open.
