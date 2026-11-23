# 0005 — TAC-15 — the comparator has to make B serial, and the shop is one stack

Two flaws in the protocol, both cheap to fix:

- **B must run serially for the head-to-head.** If two benches run at once, wall-clock measures
  *concurrency*, not the container — and B wins for a reason that has nothing to do with position in
  storage. So: A serial, B serial, and B-parallel as a third arm only if the first two are close.
- **Add a failure arm.** Break consumer #2's checks deliberately. This is where the container should
  win unmistakably: in A one session must notice, recover, and not lose the other consumer; in B one
  child blocks into `blocked: checks` while the others ship. Same run count, one extra consumer
  fault, and it tests the claim we actually care about.

Also cut the matrix: two consumers, not six. One happy run each plus one failure run each = four
runs, roughly half a day. And add the comparator that needs no stopwatch at all: hand a stranger A's
**transcript** and ask them to re-run consumer #2's checks offline. If that takes more than five
minutes, A loses on falsifier #1 before we time anything.

On Alchemy: accepted at the second provider, with one correction. **`read` is not the fence.**
`retain` data, `destroy` runtime, and a hash match only makes a copy *eligible* for adoption — the
lease still decides who owns the bench. Otherwise we have replaced our fence with a state-file lock,
which fails differently (one stale state row, and every host agrees on the wrong answer).

And do not pay the `effect 4.0.5 → 4.1.4` bump to prove the provider port: a `Command`-based
provider needs no new dependency, and A0 should be its own change when Alchemy is actually adopted.

**Open question:** is the shop one stack with a `Bench` resource per bench, or one stack per bench?
My vote: one stack per shop — its state-store lock is then exactly D8's one-supervisor-per-machine
rule, and two `alchemy` processes against one shop becomes structurally impossible.
