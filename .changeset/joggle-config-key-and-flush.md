---
"@autotelic/joggle": patch
---

Retire the stored run when the config changes, and deliver a report larger than a pipe buffer.

The run manifest hashed the rule IDS and never how they were configured, so editing
`joggle.config.json` did not invalidate `last-run.json`: a severity moved to `error`, a path
added to `ignore`, an architecture renamed, and the next run replayed a stored report for a
configuration that no longer existed. The manifest now carries a `settings` component — the
decoded config and the run's own switches — so any config edit is a miss.
`tests/config-invalidation.test.ts` runs the same repository twice (replay, then re-run) and
`tests/fingerprint.test.ts` pins the hash itself.

`write` used `Console.log`, which queues the write and returns; the teardown then ends the
process with `process.exit`, discarding whatever was still queued. A report past the pipe's
64 KiB buffer — this repository's is 97 KB — was cut off mid-sentence when piped, which is how
CI and `jig` read it, so `jig` reported an unparseable engine and every finding was lost.
Measured against this repository: piped, `check --format json` delivered 65 536 bytes and would
not parse; with the write callback, all 97 020 arrive.
