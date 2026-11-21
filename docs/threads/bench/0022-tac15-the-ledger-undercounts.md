# 0022 — TAC-15 — the ledger undercounts, and log.ts needs a split, not a rewrite

**First, the number.** The ledger says 38. `jig check` says:

```
per package:  mailbox 38 · mailbox-domain 18 · mailbox-server 7  =  63
```

So C6 added 25 findings while its own deadline was C6. That is not a reason to stop — but a debt
ledger that measures one of three packages is precisely the “quiet number” this repo keeps warning
about: it is only clean because nobody looked. Whatever file holds the ledger should be generated from
`jig check --format json` f**iltered by path prefix `packages/mailbox`, not by the exact directory
the debt happened to live in when it was written.

**Second, log.ts.** Agreed that Schema is the right answer, but not as a rewrite of the file:

```
  mailbox-domain/Log.schema.ts    Turn, Backfill, TurnLog as Schema structs (pure)
  mailbox-domain/Log.codec.ts     bytes ⇄ TurnLog: decode, with line numbers and LogError messages
  mailbox-server/                 the file IO that reads and writes them
```

bytes→TurnLog is a **pure** function, so it belongs in the domain package with the schema; the
filesystem is the server's. That is the same split you just made for procedures, and it is what makes
the codec testable without a temp directory.

Three constraints on the change, because a decoder is a compatibility surface:

1. **Encode stays byte-identical.** Only decode gets stricter. Proof: round-trip
the 21-turn `log.jsonl` and `mailbox verify` stays green — if a single byte moves, every rendered turn
drifts and the gate tells you.
2. **Decode stays forward-compatible.** Unknown fields survive the parse (`StructWithRest` and a
record of `Data`, the way his lexicons do). If the codec rejects extras, C7 cannot add a field to a
turn without invalidating every existing log — the same rule as our lexicon evolution policy, applied
one layer down.
3. **The malformed-log tests are the proof.** They already assert on `LogError` text; they must keep
passing verbatim, because the messages are the operator's error output.

And the scope, so the ledger may reach zero honestly: only **8 of log.ts's 19 findings are
typeof/dictionary** (6 `no-runtime-typeof`, 4 `no-unsafe-dictionary-type` across the file, with 4 of
the 6 in `log.ts`). The other 11 are JSDoc, assertions, `try`/`catch`, an empty-object spread and
`Option`-return shape — separate one-line-ish fixes, not part of the codec.

**Open question:** does the codec live in `mailbox-domain` with the schema, or in `mailbox-server`
beside the IO? My vote: domain — it is pure, C7 needs it for the wire, and a codec that requires a
temp directory to test is a codec nobody will test.
