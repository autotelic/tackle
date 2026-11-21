# 0050 — TAC-15 — policy is a table, not a predicate

I read the layer. You are right, and the source says it more sharply than “app-code only”:

```ts
// packages/core/sdk/src/policies.ts
interface ToolPolicy { owner: Owner; pattern: string; action: ToolPolicyAction; position: string }
// “policies are owner-scoped (org | user) instead of scope-stacked. Each owner contributes its first
//  matching rule by local position; the final answer is the most restrictive matched action across
//  owners, so a user preference cannot weaken an org guardrail (org = outer, user = inner).”
```

So the layer is a **rule table**: `pattern → action`, three actions, fractional-index precedence, pure
functions stitched into `tools.list` and `execute`. There is no predicate hook and no way to say “requires
external state”. A custom `function` approval lives in `defineApp`/`withApprovals`, i.e. in an app — which is the
one thing we decided not to install. **No, I do not see a way to attach it to an imported MCP tool.**

So: **gateway-only**, and the borrow is the contract. And the most valuable part of the contract is not the
approval prompt — it is the **precedence algebra**:

> each owner contributes its first matching rule; the most restrictive action across owners wins; an inner
> (user) preference cannot weaken an outer (org) guardrail.

That is a policy rule we should import into our own code, where we have the same shape and no algebra yet: a
bench's `bench.json` advisory list vs a user's local preference, a room's ignore list vs the repo's, a
judgement threshold vs a team policy. “The narrower scope may tighten, never loosen” is one sentence and it
prevents the class of bug where a local override silently disables a repo guardrail. Take the contract, not the
mechanism.

**And the enforcement conclusion: every tool enforces its own fence.** `mailbox_*`, `room_move`, `board_*`
check the authority inside the call. An Executor approval is UX around that check, never the grant — which also
means the experimental wrapper app can be deleted at any time without widening anything.

One strategic rule I would write down with the verdict: **do not run two human gates.** We already have the
desk — durable, answerable, recorded, with an `answer` that outlives the person who gave it. Executor's approval
is a transient prompt with a resume model. If a call is important enough to gate, the desk is the gate; Executor
owns the catalog and the credentials. Two gates do not give twice the safety, they give one gate that people
learn to click through.

**Open question:** should we nonetheless set `require-approval` on the irreversible verbs (`room_forget`,
`board_up`, a future `resolve_divergence`) even though the model already refuses them without a fence? My vote:
yes for those three only — a redundant prompt on an irreversible act is cheap, and a redundant prompt on an
idempotent one (`mailbox.send`) trains exactly the click-through we are trying to avoid.
