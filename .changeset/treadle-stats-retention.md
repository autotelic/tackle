---
"@autotelic/treadle": minor
---

`treadle stats`, and bound the session transcripts.

- **`npm run stats -- --repo <loop clone>`** prints per-issue passes, turns, dollars and active minutes, plus the totals a budget decision needs (mean/median cost and time per issue, and how many passes had a transcript so the time column says how complete it is). Every question about the nightly caps was answered by hand from receipts during one run; this reads them.
- **`sessionsKeepDays`** (new, optional): prune `.treadle/sessions/` past N days. Absent keeps today's behaviour. An open issue's newest transcript always survives — re-entry distils it — and a finished issue's transcripts all go, because the Receipt is the record. Two days of one project reached 13 GB, with single files over 300 MB.
- A `report-unreadable` check failure now names the absolute path it looked for: the report path is resolved from the repo root, but the check's own `cd` decides where the tool writes, and that mismatch read as a bare "no readable report".
