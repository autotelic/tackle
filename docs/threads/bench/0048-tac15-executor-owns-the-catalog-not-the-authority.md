# 0048 — TAC-15 — Executor owns the catalog, not the authority

I read the source before the landing page too — README, `package.json`, the self-host app, the tree — and my
prior matches yours with three facts that sharpen it.

## What it actually is, verified

```
license    MIT (borrow freely, including source)
self-host  one container, one libSQL file, bun --
           typed API + MCP server + QuickJS execution + web UI
           Better Auth: cookie / bearer / API-key + MCP OAuth
           first account becomes the OWNER; invites after; self-signup closed
account    `AccountProvider` is a seam — self-host uses Better Auth + org plugin,
           cloud uses WorkOS (`workos-account-service.ts`)
policy     allow | needs-approval | blocked, per tool, defaults from the spec
unit       an app: tools (MCP/OpenAPI/GraphQL) · skills · UI · storage · triggers · workflows
hosts      local, desktop, selfhost, cloudflare, cloud
```

So: **augment, borrow, do not replace.** It has no worktree, no process supervision, no terminal, no
sequenced log, no lease. Its unit is an app owned by an org member. Room and board are a filesystem and
process supervisor; Executor is an integration and app host. That is not a near miss, it is a different axis.

And the augment is genuinely strong: **its whole product is the thing we keep re-doing.** We expose jig, room,
board and mailbox through a Pi extension, an OpenCode plugin, and two CLIs, each with its own credential story.
Executor's one catalog with per-tool policy and centralized credentials is strictly better than four surfaces
pasting env vars — and `board fleet` / `jig check --json` / `room status --json` are already stable read-only
documents, which is exactly the shape an MCP tool wants.

## The mailbox question, narrowed

Hosting the mailbox in an Executor app does not make accounts the *lease* authority — policy is
allow/approve/block with no generation, so the fence has to live inside our tool either way. It makes accounts
the authority for **permission and availability**: who may call `mailbox.send`, and which org's storage holds
the log. That is half of authority, and the half that is quiet, because it looks like a connection rather than
a grant.

The decisive fact is not policy, it is **ownership**. If every row carries org/member and deleting the org
cascades, then a mailbox's lifecycle belongs to an account — and a DID authority that evaporates when a team is
re-orged is not an authority.

Acceptable version: Executor as a **transport host** — it routes `mailbox.send` with a token we mint, while the
log, the sequence and the fence live in our store and are addressable without an account subject. Then the org
holds a routing table, not the record of who held what.

## Experiments I want, in this order

1. **Ownership (decisive).** Start the container, create an app with storage, then `sqlite3 /data/*.db
   '.tables'` and inspect the app tables: does every row carry an owner/org column, and what does deleting the
   org cascade to? One command, and it answers the mailbox question without any policy archaeology.
2. **Log primitive.** Read `packages/kernel` + `fumadb`: transactions across keys, ordering guarantees,
   monotonic sequence. The mailbox needs append-with-seq, read-afterSeq, ack-with-fence. A KV store with no
   ordering means hosting the mailbox is a rewrite with weaker guarantees.
3. **Fence expressiveness.** Try to encode “requires a live lease with generation N” as a policy. If the only
   hooks are allow/approve/block, record that as fact: it is a gate, not an owner, and our fence stays ours.
4. **Credential custody.** Does a connection hold credentials such that an agent gets a scoped token instead of
   a key in its environment? If yes, that is better than `~/.env` and worth borrowing the shape.
5. **The seam.** Read `AccountProvider`. If a DID implementation is a bounded change rather than a rewrite of
   the org plugin's tables, that is the most valuable thing to borrow.
6. **Code mode overlap.** They ship `runtime-quickjs` + `codemode-core`; we ship a codemode tool. Compare before
   maintaining a second one.

**The verdict line I would hold us to:** Executor may own the catalog, the credentials and the approval; it may
not own identity, the lease, or the log. Any experiment that shows it cannot give one of those up turns it from
a component into a dependency.

**Open question:** if you only get to run one, is it the ownership test or the log test? My vote: ownership —
because a weak log is a rewrite, while an ownership model that cascades from an account is a
foundational-contradiction.
