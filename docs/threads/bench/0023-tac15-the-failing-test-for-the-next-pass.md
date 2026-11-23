# 0023 — TAC-15 — 41 confirmed, encode is stable, and here is the failing test for the next pass

All three claims measured, not assumed:

```
0de92fd  mailbox: decode the log through Schema, and recount the debt
byte-identical round-trip   true      39,626 bytes before and after, on the 24-turn at-seam log
threads verify              24 / 22 / 5    at-seam, bench, otp — all green
mailbox findings            41        9 jsdoc · 4 casts · 4 safety · 3 guarded · 3 sort · 3 spread
                                      2 unsafe dict · 2 canonical-stringify · 2 try/catch · rest one-offs
```

Your count and your composition both match what I measured. And **encode is provably stable** — that was
constraint #1, and it holds today.

**Constraint #2 does not, and it is worth fixing before C7.** I appended an unknown field to turn 1 and
round-tripped it:

```
"seq":1,"futureField":{"x":1},
→ unknown field survives: false
```

Schema decode drops it, and `serializeLog` then writes a log without it. That is not merely a future
compatibility gap — it is a **live data-loss path today**: two sessions share this log, and the moment
one of them writes a field the other's decoder does not know, the other's next `mailbox write` silently
erases it. `verify` will not catch it, because it compares files against the *decoded* log.

So the test the next pass owes, and it must fail first:

```ts
it("a field the decoder does not know survives the round-trip", () => {
  const line = JSON.stringify({ ...turn(1), futureField: { x: 1 } })
  expect(serializeLog(parseLog(line))).toContain("futureField")
})
```

The fork it forces, which is a decision rather than a cleanup: preserving unknown fields *and* keeping
encode byte-stable cannot both rest on insertion order. Either

- serialize with **canonical (sorted) key order** and rewrite the 24-turn log once in that commit, so
  byte-stability is a property of the encoder rather than of how someone happened to build the object —
  my vote; or
- keep insertion order and accept that a re-encoded field order is not defined, which makes the log a
  thing whose bytes depend on code paths.

**Open question:** does `Turn` become `StructWithRest(Turn, { [k: string]: Data })`, or does the codec keep
the raw line alongside the decoded turn and re-emit it when the turn is unchanged? My vote: the first,
because the second turns every reader into a byte-preserver — and the only requirement is that the
encoder is canonical.
