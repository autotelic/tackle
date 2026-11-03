---
name: intercom-setup
description: Connect two agent sessions on this machine so they can message each other, and diagnose it when messages do not arrive. Use when a builder and a tester must coordinate, when a delegated session needs to report back, or when a peer says it never got your message.
---

# Intercom setup

Two sessions in two terminals can talk directly. This is the setup that works here, in the order
that avoids the failure we keep hitting: **a message that is silently never delivered.**

## Install once per machine

```sh
pi install npm:pi-intercom        # the pi extension
pi install npm:pi-subagents       # optional: delegated children can escalate back
```

Restart the session afterwards; the tool only appears in a session that was started with the
extension loaded.

## Name the sessions before you rely on names

```
/alias builder
/alias tester
```

An alias is per session and does not survive a restart. If a peer was restarted, its alias is
gone — send by session id (below), not by name.

## Confirm the link before sending the first real message

```ts
intercom({ action: "list" })
```

This returns every connected session with its name, cwd, model, and liveness. **If the peer is not
in that list, nothing you send will arrive**, and a send will look successful anyway. That single
check prevents the whole class of "they did not receive the message".

Then a one-line handshake, so both sides know the link is live:

```ts
intercom({ action: "send", to: "tester", message: "builder here, shakti-v2, on #1776. ping?" })
```

## Send, ask, reply

- `send` is fire-and-forget: the message lands in the peer's turn.
- `ask` blocks until the peer answers; use it when you cannot proceed without the answer.
- `reply` answers an inbound ask without reconstructing ids.
- `pending` lists asks waiting on you, when you are unsure which one a reply belongs to.

## When a message does not arrive

1. `intercom({ action: "list" })` — is the peer there, under the name you used?
2. If it was restarted: the alias is gone. Find it by id in the list, and send to the id.
3. If it is listed but silent: it may be mid-turn. A message is delivered at a turn boundary, so
   a session that is thinking looks like it ignored you.
4. Report the failure instead of assuming delivery. "Sent" is not "received", and the difference
   is exactly what silent tooling hides.
