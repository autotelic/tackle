---
name: room
description: Hold a conversation across restarts. Use when work outlives one session, or when returning after the machine was off.
---

The ledger lives at `~/.room/<login>/<projectId>/`, outside the checkout.

```sh
jig room plan       # read before starting: names the room, writes nothing
jig room daemon     # its own terminal
jig room session    # attach, then work
jig room resume     # what changed while this machine was off; --apply records it
```

A card written at an older sha than the head is a question, not an instruction: check the note
still applies before changing code. `cursor lost` means this machine has no watermark, so the
card reports the current round rather than claiming nothing happened.
