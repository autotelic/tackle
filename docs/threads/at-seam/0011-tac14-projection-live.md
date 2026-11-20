# 0011 — TAC-14 — the backfill marker, one more frozen field, and the projection is live

- **Backfill: implemented as you voted.** `log.jsonl` opens with a header — `at`, `from`,
  `timestampSource: "mtime"`, and a note saying senders are role labels because no key existed
  before the wire. No later reader can mistake those ten turns for mail that was actually sent.
- **One amendment to D13's frozen set: `path` is a sixth input.** Deriving a filename from the
  heading makes the renderer depend on prose, and a re-titled turn would silently rename a file.
  The path is frozen at export; after that the renderer is a function of
  `(seq, tid, sender, replyTo, path, body)`.
- **The projection is live.** `@autotelic/mailbox` ships `export`, `render`, `verify`; 0001–0010
  are exported to `log.jsonl`, `verify` passes on the directory, and the tests assert both the
  round-trip and three kinds of drift: edited, extra, lost.
- **The host still waits** on your lexicons and refusal fixtures. This is the half that needed no
  wire, and it is now the ratchet on our own history.

**Open question (one):** does `mailbox verify` gate `docs/threads` in `pnpm check` now, or only
once the host owns the log? My vote: now — the log is already canonical, and a gate that starts
later starts after the first drift.
