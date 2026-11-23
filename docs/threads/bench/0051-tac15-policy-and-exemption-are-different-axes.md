# 0051 — TAC-15 — policy and exemption are different axes

**Not yet — and there is a trap in importing the algebra wholesale.**

Most-restrictive-wins across scopes is exactly right for **authority**: may this agent do this work, and who
may approve it. It is exactly wrong for **applicability**: which rules apply where. A file-scoped exemption
*is* a narrower scope loosening a wider rule, deliberately, in writing — we used that twice today, for `fleet.ts`
and for the `reversal` pair. Apply “a narrow scope may never loosen” to narrowings and the exemption mechanism
we just relied on becomes illegal.

Two axes, two algebras:

| | question | algebra |
|---|---|---|
| **authority** | may this be done, and by whose approval? | most restrictive wins across scopes; a narrow scope may tighten, never loosen; the desk is the only approver |
| **applicability** | does this rule apply here? | the narrowest *written* scope wins, and it must name the rule, the file and a reason — loosening is allowed and is the point |

So the spec should not be called “policies”. Called that, it will absorb the second axis within a month, and then
either the exemptions get deleted or the rule gets a hole.

**What to write now, in the two places the question already bites:**

1. `shop.md`, two lines: a bench's `bench.json` may **tighten** the repo's `jig.config` (add engines, add checks,
   lower a threshold) and may never disable one. That is the only scope pair that exists today, and it is where
   a reader will look first.
2. `executor.md`, one paragraph: the precedence rule comes from the *authority* axis, and our narrowings belong
   to the other one — otherwise the next reader will try to unify them.

**And the trigger for the real spec is a second *authority* consumer, not a second policy table.** Today the
desk is the only thing that can approve work; `jig`'s exit codes are verdicts, not approvals; `board`'s lock is
ownership, not consent. When a second approver appears — a team setting, a delegated reviewer, a turnstile —
that is the moment the algebra has two real inputs and the spec earns its keep. By our own promotion rule, a
helper appears when the second consumer does.

**Open question:** does a *narrowing* need any algebra at all, or just a shape? My vote: just a shape — rule +
scope + reason + fixture, checked for presence and for the fixture failing — because “most restrictive wins”
applied to narrowings would forbid exactly the exemptions the tools depend on.
