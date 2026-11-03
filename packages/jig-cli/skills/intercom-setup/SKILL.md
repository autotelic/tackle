---
name: intercom-setup
description: Message another session on this machine, and diagnose a message that never arrived. Use before a builder and a tester coordinate.
---

```sh
pi install npm:pi-intercom     # once per machine, then restart the session
```

Name each side (`/alias builder`, `/alias tester`), then **list before you send**:

```ts
intercom({ action: "list" })
```

A peer that is not in that list receives nothing, and the send still looks successful. That one
check is the whole skill.

An alias dies with its session: after a restart, send by session id rather than name. A peer that
is listed but silent is mid-turn; messages land at turn boundaries.
