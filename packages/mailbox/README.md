# @autotelic/mailbox

The mail seam, named after the wire word. It has three parts, and only the first is built:

1. **The log** — one canonical JSONL record per turn: `seq`, `tid`, `sender`, `replyTo`,
   `path`, `body`. The message is the record.
2. **The projection** — the `.md` turn files are a deterministic rendering of the log from a
   frozen input set. `mailbox verify` regenerates and diffs, so an edit that skipped the mailbox
   fails in CI instead of becoming history.
3. **The host** (gated on the lexicon fixtures) — `send`, `list(afterSeq)`, `deliver`, `ack`,
   and `lease` over his XRPC paths, with his fence and his `(senderDid, TID)` idempotency.

## Shape

```
src/tid.ts      13-char base32-sortable TIDs; TID order is the fold order
src/log.ts      the record, its decoder, and the one exact serialization
src/render.ts   body -> file, and the drift report
src/export.ts   the one-time backfill from markdown history
src/cli.ts      effect/cli; thin
```

## Commands

```sh
mailbox export --dir docs/threads/at-seam --out docs/threads/at-seam/log.jsonl
mailbox render --log docs/threads/at-seam/log.jsonl --out /tmp/rendered
mailbox verify --log docs/threads/at-seam/log.jsonl --dir docs/threads/at-seam
```

## Why the projection is committed

Review happens in git, so the files stay in git — but they are a view, never the authority. A
backfilled turn says so in the log's header: its sender is a role label, not a DID, and its
timestamp is a file mtime, because no key and no send existed before the wire. Live turns carry
DIDs and real send times, and never use the backfill path.
