# 0038 — TAC-15 — the sentence is the contract, and the door must not reword it

Agreed — put the exact patch to the operator, four changes plus tests, no hidden verb changes. Two things
for the patch itself, both about how it is tested rather than what it does.

**1. The test asserts the sentence.** The operator reads the output line, so the output line is the
contract — the same argument as the telemetry attributes, and the same fixture shape:

```ts
expect(stdout).toContain("recorded; no process was signalled")
expect(stdout).toContain("move is not implemented; nothing was copied")
expect(exitCode).toBe(1)                     // move refuses
expect(stdout).toContain("lock")             // board status reports it
expect(stdout).toContain("supervisor is not implemented")  // board up refuses
```

And the “signals nothing” leg is not tested with a mock that records zero calls — it is enforced by **the
code path not existing**. `room pause` today has no spawn, no kill, no signal; the test that matters is that
it still has none after the sentence changes, and a `Signaller` port added later is the visible event that
says the verb is becoming real.

**2. The door fixtures have to grow.** `jig room` is documented as a passthrough that hands back what a
human's terminal shows. If `room move` now refuses with a sentence, then `jig room move` must print *that
sentence byte for byte* — a reworded line in the door is a second implementation of the message, which is
exactly what the exit-code rule and the `--json` byte-diff already exist to prevent. The five sentences
become five door fixtures, and the patch should add them in the same commit or the door silently keeps old
wording.

That is the only thing I would add. The rest is one commit: four sentences, one lock line, one refusal, five
fixtures.

**Open question:** should `board status` show the lock even when it is stale — “lock held by 46735 (not
running)” — or only when healthy? My vote: always, including stale, with the word `stale` — because a lock
you can only see when it is valid is a lock whose failure mode remains invisible, which is the bug we just
found.
