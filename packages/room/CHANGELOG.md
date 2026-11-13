# @autotelic/room

## 0.1.0

### Minor Changes

- 4e04108: The room's session is pi-durable, wired the way the brief described it.

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

- 48f83a7: `jig room doctor` names a missing `pi`, and onboarding says what the room needs on a machine.

  Both halves of the loop run `pi`: the review job spawns it, and the wake resumes the project
  session with it. A machine without it looked healthy until the first event nobody answered, so
  doctor now checks it beside `celld` and names the consequence. `doctor` also takes an optional
  PATH lookup, which is how the check is tested without pretending to be a different machine.

  The generated `ONBOARD.md` grows a real room sequence instead of a single paragraph: `plan`,
  `init` after approval, `doctor`, then `dev`, `webhook | sh`, and `daemon` — with the checks
  doctor can name spelled out (`celld`, the `gh webhook` extension, a Linear token, `pi`) and the
  reminder that `hc` is only for `room work`. `JIG.md`'s room section gains the commands it was
  missing and points at `jig room doctor` rather than keeping a prerequisite list that goes stale.

- 9556d1c: `room resume` diffs GitHub against what this machine last saw.

  A durable conversation is not a durable subscription: the room stores talk, and nothing stored a
  watermark, so a cold start could not tell "nothing happened" from "I was asleep for six hours".

  - `~/.room/<login>/<projectId>/resume.json` — machine state, beside the session and outside the
    checkout, so it survives a reboot and a `git clean`. The output says the cursor is machine-local,
    because "nothing new" means "nothing new _to this machine_".
  - the cursor carries `lastReviewId`, `lastCommentId`, `seenSha`, `seenAt`, and a capped `recent`
    map of id -> {state, bodyHash}. The map exists because of three measured facts: a review has no
    `updated_at` (only a body hash sees an edit), a comment's `updated_at` carries a one-second
    creation skew (so it is not an edit signal), and a dismissal keeps its review id (so an id
    watermark never sees a state change).
  - a normal run reports the delta: reviews and inline notes by id, with the state named, the sha
    each review was written at, and the head now — the difference between "Ed asked for this" and
    "Ed asked for this and it is already fixed".
  - a cold start reports the _current round_ rather than every review the PR ever had: latest review,
    its state and sha, and the notes after it. One PR with five reviews and forty-two notes is not a
    card anyone can act on.
  - cards only, never turns; `--apply` appends them to the inbox by a deterministic id (the ledger's
    own dedupe makes a re-run a no-op) and advances the cursor. Without `--apply` nothing is written.

  Measured on two real pull requests: `#1776 · cursor lost · latest: approved at 83fe79a3 (head
83fe79a3) · 2 inline note(s) after it`, and the same shape for #1773.

- a873158: An attached room seeds itself from `room.config.json`, and the board reports delivery as well as
  claims.

  Run 4 found the one missing wire: `room.config.json` declares the actor, the watched label, the
  Linear user, and the batch hold, but only `PUT /config` ever moved them into the ledger — and
  nothing called it. An attached room therefore accepted every webhook, queued no job, delivered
  no inbox item, and read clean until someone PUT the config by hand, live.

  - `seedRoom` copies the file into the ledger, idempotently, and runs from `jig room dev` (once
    the room answers), `jig room daemon` (every start), and `jig room init` (when the room is
    already up). It seeds from the _committed_ config rather than the flags of the day, so a
    re-run without `--label` cannot silently drop the label.
  - The actor is seeded normalized (`github:<login>`), which is what the review policy compares;
    a bare login left `review_requested` addressed to the room unmatched.
  - `batchMs` joins the config schema, so a file that declares it is no longer decoded away.
  - The board reports what arrived next to what can be claimed:
    `inbox   1 turn(s) · 1 card(s) waiting · 2 held by the batch`, and `chits` keeps its own
    meaning. Four delivered events no longer read as "chits none".
  - `jig room init --help` names `room.config.json`, not the pre-move `.room/config.json`.

- 12b49f9: The room's session is a durable conversation, opened on `@earendil-works/pi-durable`.

  The room's brief named pi-durable and the room did not use it: it grew its own session registry —
  a `PUT /session` heartbeat, a 60-second staleness window, a `shouldWake` predicate, and a
  `pi -p --session` spawn to wake what had gone quiet — and the failure mode that produced was a
  room accepting events and queuing nothing until someone `PUT /config` by hand.

  `src/session.ts` is the seam now: `openRoomSession` opens the conversation over the room's own
  sqlite storage, `submitToRoom` hands it a delivered item (busy/idle admission is the library's),
  and `roomSessionView` reads the live state — busy, queue, and why the last run ended. Verified
  on this machine: a conversation opens (id `1`), a submission is admitted (id `8`), and with no
  provider configured the view reports `runFailure: "no_model"` instead of silence.

  Also recorded: `tools/foreman/journal.md` §1.1 concluded that pi-durable "is not in this
  environment" because it searched for `pi-durable` and `@autotelic/pi-durable`; the package is
  `@earendil-works/pi-durable` and it is on npm. The section now says so.

  The heartbeat, the wake spawn, and the `setWidget` block are next: the daemon submits through
  this module, and the badge moves into the editor border.

- df18cef: The session that owns a room is now named, in the ledger and in the UI.

  A room delivers to exactly one session id, so "which session is the room watching" is a
  question with one right answer — and until now nothing showed it. The board carries it:

  ```
  room tackle · local/togmund
    roomd   reachable · 1 present
    session 7f1c2a9b · attached, 12s ago
  ```

  The pi extension reads that and keeps a keyed status line (`ctx.ui.setStatus("room", …)`)
  that says `room tackle · this session` while it owns the room, `room tackle · session 7f1c2a9b`
  when another session has taken over, and `roomd down` when nothing is listening — so a
  session that is about to be woken by a headless resume says so. It also sets the session name
  (`pi.setSessionName`) once, and only when nobody has named the session already, so the resume
  picker and the tab title carry the room's name.

  `renderBoard` takes `now` as an argument now, so the rendering stays pure and the clock is
  read at the command boundary.

### Patch Changes

- b6ce9ec: `roomd` now resumes the session it is supposed to.

  The README and the commit that added it both said the daemon wakes a session whose heartbeat
  had gone stale. The check was inverted, so the opposite happened: a closed session was never
  resumed, and an open one got a second `pi -p --session` writer in the same transcript.
  `shouldWake` states the rule in one place — a known id and a stale heartbeat — and the
  extension keeps owning the inbox while a session is open.

- Updated dependencies [e12d0f1]
  - @autotelic/board@0.1.0
