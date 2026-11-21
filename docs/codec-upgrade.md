# The log codec: two versions, one canonical form

## The problem

The Schema decode validates a line and drops every field it does not know. A second writer
running newer code then re-encodes without those fields — a silent downgrade of a shared log.
The obvious fixes look like a fork:

- preserve unknown fields and keep the original key order, or
- canonicalise key order and rewrite the log once.

## What Erlang already answers

Armstrong's thesis, §3.8 “Dynamic code change”: a running node keeps **two versions** of a
module. Old processes may keep executing old code; new calls take the new code; the programmer
is responsible for making the new code compatible with the old. Code replacement is safest at a
tail call, because then no old code remains to return to and the old version can be deleted.

That is the shape of the log migration. Two versions coexist only while a process still holds
old data. The moment the writer reaches a safe point (a tail call — here, a quiesced write
barrier), the old version can be retired and the canonical form written once.

Erlang's external term format is the other half: terms have a deterministic external encoding,
so the same term is the same bytes. A log needs the same property or every writer produces a
different file.

## What Rat King already answers

The v0 lexicon README is explicit: after publication new fields stay **optional**, existing
identifiers and encodings stay, unions stay **open**, and only unknown tags take the lossless
forward-compatible branch. Forward compatibility is a property of the format, not a courtesy of
the decoder. A codec that drops unknown fields is not Rat King-compatible even if every known
field validates.

## Decision

Both, not either:

1. **Retain unknown fields.** The decoded turn keeps an open tail; encode writes it back.
2. **Canonical key order, recursively.** Sorted keys make the bytes a function of the value.
3. **One-time rewrite at a write barrier.** The lease is the barrier: only its holder may
   rewrite. There is no dual encoding; the log has one canonical form after the migration.

The migration is Erlang's code change: the old version is read, the new version is written, the
old version is retired at a point where no writer can still hold it. The fence makes that point
provable instead of hopeful.

## Consequences

- A new optional field needs no migration; an old writer preserves it.
- An unknown field from a newer writer survives a round trip through an older writer.
- The existing 24-turn at-seam log is rewritten once; after that, encode is idempotent and
  byte-identical.
- A canonical encode of a value with unknown fields is still canonical: sorted keys, all keys.

## Test

- decode a line with `futureField`, encode, and assert the field is still there;
- encode the 24-turn log, decode, encode again, and assert the same bytes;
- the one-time rewrite changes only key order, never a value.

## Journal identity

`journal.sha` is sha256 over the **DAG-CBOR record set**, not over the JSONL file's bytes. DAG-CBOR
orders map keys by length then bytewise (DRISL), so the digest is a function of the records. The
one-time key-order rewrite therefore did not change any journal's identity; a continuation token
that had recorded file bytes would have read as divergent for no reason.

The token carries the digest, the record count, and the lease generation. Hash once, in CBOR; do
not start with a JSON digest and migrate the token later.
