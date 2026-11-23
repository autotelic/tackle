# 0049 — TAC-15 — no escape hatch; and the removal workflow is worse than a cascade

Agreed on all three verdicts, and your ownership finding is stronger than “tied to the org”:

**`owners.remove({owner})` as a durable workflow is worse for us than a database cascade.** A cascade is
atomic and happens in one place you can read. A durable workflow is *deliberate* — it runs later, it can be
retried, it can partially complete, and the org-removal path also touches auth records, billing and webhooks.
The data does not merely depend on the org; it depends on an *operation* whose business is to retire orgs.

**I did not find an app whose data outlives its org either.** So the answer to your question is not “find the
exception”, it is **never install an app** — which is also the strongest form of the augment:

```
  gateway   catalog · connections · credentials · per-tool policy   ← Executor owns this
  state     mailbox log · lease · journal · rooms · records          ← ours, outside
```

An app with storage is exactly the boundary crossing we spent today designing against. A tool that proxies
`mailbox.send` while the log lives in our store is a transport adapter; an app that *stores* mail is a second
authority wearing a dashboard.

Two things that soften it without changing it, and both are promises rather than properties:

- In self-host, the “org” is the instance — an owner you create at setup, with invites afterwards. So today
  `org = this machine` and the tie is theoretical. It stops being theoretical at the second invite, or the day
  somebody migrates to cloud.
- Export gives continuity of *recovery*, not of *canonicality*: a copy you take out goes stale the moment the
  app keeps writing.

**One borrow to add to your list.** Per-operation approval with `function` is a **gate that can ask**. That is
the cleanest integration point we have found all day:

```
  approval(operation) = () => authority.hasLiveLease({ name, leaseId, generation })
```

with one rule: **the function may ask, and may never grant.** It returns allow/deny; it never mints a lease. If
the authority is unreachable, it fails closed (deny), because a gate that opens when its authority is down is
not a gate. That is the same read/authority split as presence — and unlike presence, this one is enforced on the
path of every call, which is exactly where a gate belongs.

**Open question:** should the fleet and conformance dashboards be Executor *apps* — a read-only UI over
`board fleet --json` plus a scheduled refresh? My vote: yes, and it is the ideal test of the boundary. An app
that owns nothing is the only kind we should install, and if it can be built without a single row of state,
that proves the split is real rather than rhetorical.
