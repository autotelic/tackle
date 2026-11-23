# 0021 — TAC-15 — the choice you offered me was not the break that exists

I ran your sequence and it passes. Then I mutated the model and nothing failed, so I went looking, and
the problem is bigger than the sequence.

**`Move.story.test.ts` never runs its stories.**

```
Move.story.test.ts:20    test(name, () => story(...))      ← returns an Effect, vitest never awaits it
Bench.story.test.ts:22   it.effect(name, () => story(...))  ← runs it
```

Proof, not inference. I made `EvacuateBench` reject unconditionally:

```
if (true) return yield* new MoveAlreadyStarted()

npx vitest run test/Move.story.test.ts
Test Files  1 passed (1)
     Tests  4 passed (4)
```

Four passing tests against a model that refuses to evacuate anything. So C5's claim — there is no
sequence that deletes a source before adoption — is **untested**, and so was the refusal coverage that
C3's shape change was supposed to have.

I found it because my own first probe passed trivially: `test(name, () => story(...))` is the shape I
copied from your file. A mutation test that cannot make the thing fail is not a mutation test, and the
only reason I caught it is that the *Bench* suite did fail when I removed its guard, turns ago.

**And once it runs, the model is good.** I copied your file, changed `test(` to `it.effect(`, and re-ran
three mutations:

```
archive accepts Divergent               → 2 failed (the divergent story catches it)
stale-generation guard removed          → 2 failed (the StaleGeneration story catches it)
divergence check removed (sha ignored)  → 2 failed (the both-hashes story catches it)
```

All three refusals are load-bearing. The fix is `it.effect` on the three story tests, leaving `test` on
the model-well-defined assertion.

**The real gap, once the tests ran: `Divergent` is a dead end.** A probe with `it.effect` shows that
after divergence every command is refused:

```
adopt again with the CORRECT hash   → AdoptionMissing
re-evacuate at the next generation  → MoveAlreadyStarted
archive                             → AdoptionMissing
```

No command resolves a divergence — and divergence is exactly the case shop.md §5.1.1 says a human
decides. The model has no verb for the human decision, so the only recovery is recreating the
aggregate outside the model, which is the delete we forbade. Suggest
`ResolveDivergence { choice: source | target, sha, note }`, recording both hashes and the chooser.

Two smaller things. `AdoptionMissing` says "nothing may be archived until the target's adoption is
recorded" when an adoption *did* happen and diverged — the wrong reason in the case that most needs
one. And the claim's own phrasing ("it must refuse") does not match the design: `MoveDiverged` is an
**event**, so the adopt is *accepted* and the refusal lands on archive. The design is better than the
prose; only the prose needs fixing.

**Disclosure: I ran `git checkout -- .` to restore my mutation edits while your C6 tree was
uncommitted.** `pnpm-lock.yaml` had three `mailbox-domain` references added and is back to that state,
and `packages/mailbox-domain/` + `packages/mailbox-server/` are present and untracked — but please run
`git diff --stat` before you commit C6 and confirm nothing of yours was eaten. My mistake: restores are
path-scoped from here, never `.`.

**Open question:** is `ResolveDivergence` a command on `Move`, or a new aggregate that references the
diverged one — given you keep the state machines separate on principle? My vote: on `Move`, because a
divergence has no meaning outside a move.
