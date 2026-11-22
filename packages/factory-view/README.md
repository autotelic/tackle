# @autotelic/factory-view

The software factory's view: one page that shows every open workstream, its
phase, its checkpoint, the pending desk item, the sessions that can open it, and
the reports the factory has consumed.

It is a Foldkit application. State arrives as one `/presence` read; every
transition is a message, and the UI has no local source of truth.

It is assembled from **primitives**, not a component kit: `ticks` from
`foldkit-primitives/time` refreshes presence every 20 seconds, and `copyText`
from `foldkit-primitives/dom` is a Command whose `Copied`/`CopyFailed` result
is reduced by `update`. The layout is plain Foldkit HTML and CSS, so a repo is
a section and a phase is a lane rather than a widget with its own state.

## Shape

```
/presence  ──decode──▶  Presence
                         ├─ observedAt           the instant the board read every source
                         ├─ factory.workstreams  id, repo, phase, pr, checkpoint, cursors
                         ├─ factory.desk         id, title, workstream
                         ├─ factory.reports      kind, workstream, expected, actual, at
                         └─ sessions             herdr / rex addresses + workstream
```

The view never imports `board` or `factory`. The JSON is the seam; the local
schema is the wire contract.

## Freshness

Every panel carries an age and a freshness value, because a dashboard that
looks healthy while frozen is worse than none.

- `freshness ∈ {fresh, stale, unobserved}`: `unobserved` means _nobody looked_,
  which is not the same as _nothing happened_. Each workstream shows its three
  sources (`github`, `linear`, `reports`) separately, so one quiet source cannot
  hide behind a fresh one.
- Ages use seconds under a minute (`observed 4s ago`), never a truncated `0m`.
  A workstream with no checkpoint says `no checkpoint yet`, not `0m ago`.
- The header shows when the page itself last polled. A failed poll clears the
  frame and shows a `feed lost` banner with the failure and the last good read;
  it does not leave the last good frame on screen looking current.

## Run it

The board serves the built view at `/factory`:

```sh
pnpm --filter @autotelic/factory-view build
board up --root .room --host 127.0.0.1 --port 4780
open http://127.0.0.1:4780/
```

For UI work, run Vite with the board already up:

```sh
pnpm --filter @autotelic/factory-view dev
# http://127.0.0.1:4782/ — proxies /presence to 4780
```

## What each row means

The page starts with the kernel's state machine and the current count in each
phase. Below it, workstreams are grouped by **repository**, then by **phase**,
so a repo is a section and its lanes are the states it currently occupies.

- **Workstreams** — one card per adopted workstream, in phase order. `phase` is
  the kernel's state; `checkpoint` is the commit the last pass stopped at, with
  its age (or `no checkpoint yet`). The matching live sessions sit inside the
  card, so the jump to the conversation is on the workstream itself. A session
  joins by an explicit `workstream=<id>` label, by cwd inside the workstream
  path, or by the words in its tab title; an unmatched session stays in the
  bottom list rather than being guessed onto a workstream.
- **Desk** — questions waiting for a human. The view does not answer them; it
  shows which workstream asked.
- **Sessions** — Herdr and Rex addresses. `Open` asks the board to focus the
  session in its app: a Rex block is focused by block id, and a Herdr terminal
  is attached in Terminal with `hc attach …`. `Copy` gives the command instead.
  Sessions with no evidence of a workstream are listed separately, never
  assigned by guesswork.
- **Reports** — structured feedback the factory consumed, with expected and
  actual text side by side.

The refresh button is deliberate: this is an observation surface, not a
controller. The only action is `POST /open`, which validates the address and
runs `rex block focus` or `hc attach`; factory state is never written here.

## Tests

`packages/factory-view/test/freshness.test.ts` covers the three freshness
values, the sub-minute age labels, and `no checkpoint yet`.
`packages/factory-view/test/view.test.ts` renders the real Foldkit view through
the scene harness: all three freshness badges, per-source freshness, the null
checkpoint, and the lost-feed state after a failed poll.
