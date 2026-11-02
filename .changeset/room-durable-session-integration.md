---
"@autotelic/room": minor
---

The room's session is pi-durable, wired the way the brief described it.

- **Delivery is a submit.** `roomd` hands an inbox turn to the durable conversation; the library
  queues it behind a running answer and starts the run when idle. `wakeSession` (a
  `pi -p --session` spawn), `shouldWake`, the staleness window, the 60s wake throttle,
  `PUT /session`/`GET /session`, and the board's "attached" line are gone with the registry they
  implied.
- **Broadcast is a write.** `noteToRoom` records `{kind, data}` entries the model never sees,
  which is exactly what an automatic hook wants; the Pi extension posts `room.edit` on every
  `edit`/`write` tool end and `room.session` on shutdown, with no agent decision in the loop.
- **Multiplayer is the storage.** `room session [--json|--say|--note|--watch]` opens the same
  sqlite the daemon does: one conversation, many clients, the library decides who runs.
- **The badge is the editor's top border** (`setEditorComponent`, the shape pi-fabric uses):
  `room <name> ....... busy | idle | <runFailure>`. No widget above the editor, no registration
  on `session_start`.
- **Setup wires the webhooks.** `room webhook --create` prints the `gh api` registration for a
  deployed room (`--apply` runs it) and refuses a loopback URL with the forward command instead;
  Linear's delivery URL is printed beside it.

Validated against a local celld: a config-only repo seeds itself, a review webhook becomes an
inbox turn, `room daemon --once` reports `delivered 1 turn(s) to session 1`, `room session
--watch` streams the `pi.user` entry with the review body, and `--note room.tool` lands a
`room.tool` write the model does not see.
