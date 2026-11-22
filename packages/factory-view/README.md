# @autotelic/factory-view

The software factory's view: one page that shows every open workstream, its
phase, its checkpoint, the pending desk item, the sessions that can open it, and
the reports the factory has consumed.

It is a Foldkit application. State arrives as one `/presence` read; every
transition is a message, and the UI has no local source of truth.

It is assembled from **primitives**, not a component kit: `ticks` from
`foldkit-primitives/time` refreshes presence every 20 seconds. Copy is a Command
too, but the clipboard is only half of it: `src/copy.ts` tries
`navigator.clipboard` and falls back to selecting the command text, so iOS Safari
can copy it by hand. The layout is plain Foldkit HTML and CSS, so a repo is a
section and a phase is a lane rather than a widget with its own state.

## Shape

```
/presence  ──decode──▶  Presence
                         ├─ factory.workstreams  id, repo, project, phase, pr, checkpoint
                         ├─ factory.desk         id, title, workstream
                         ├─ factory.reports      kind, workstream, expected, actual
                         └─ sessions             herdr / rex addresses + workstream
```

The view never imports `board` or `factory`. The JSON is the seam; the local
schema is the wire contract.

## Run it

The board serves the built view at `/factory`:

```sh
pnpm --filter @autotelic/factory-view build
board up --root .room --host 127.0.0.1 --port 4780
open http://127.0.0.1:4780/factory
```

For UI work, run Vite with the board already up:

```sh
pnpm --filter @autotelic/factory-view dev
# http://127.0.0.1:4782/ — proxies /presence to 4780
```

## On a phone

The operator reads this from a phone on the tailnet, so the phone is the
primary layout, not a shrunken desktop. `tailscale serve` terminates TLS for
the board and gives the page a secure origin — which is also what the clipboard
API needs:

```sh
board up --port 4780
tailscale serve --bg 4780
# https://<machine>.<tailnet>.ts.net/factory
```

`tailscale serve status` shows what is proxied; `tailscale serve reset` removes
it. The board still binds `127.0.0.1:4780`, so nothing listens on the LAN
interface.

At 390px the page is one column: a repo heading, its workstreams, and one
tap-opened detail. Every heading is a 44px disclosure button with a visible
chevron, so nothing is revealed by hover. Long identifiers wrap rather than
pushing the page sideways. The session's attach command is rendered as text and
`Copy` tries `navigator.clipboard` first; where iOS Safari refuses it, the
command is selected so the long-press menu can copy it.

## What each row means

The page starts with the kernel's state machine and the current count in each
phase. Below it, workstreams are grouped by **repository**, then by **phase**,
so a repo is a section and its lanes are the states it currently occupies.

- **Workstreams** — one card per adopted workstream, in phase order. `phase` is
  the kernel's state; `checkpoint` is the commit the last pass stopped at. The
  summary is a disclosure: tap it to reveal the matching live sessions and the
  activity for the last pass. A session joins by an explicit
  `workstream=<id>` label, by cwd inside the workstream path, or by the words in
  its tab title; an unmatched session stays in the bottom list rather than
  being guessed onto a workstream.
- **Activity** — each card says when its last pass ran, whether it is stale,
  what that pass quality was, and what events are queued with their own
  summary. A build that has not passed for two hours is visibly stale instead
  of looking identical to one that just ran.
- **Desk** — questions waiting for a human. The view does not answer them; it
  shows which workstream asked.
- **Sessions** — Herdr and Rex addresses, each with the attach command shown as
  text. `Open` asks the board to focus the session in its app: a Rex block is
  focused by block id, and a Herdr terminal is attached in Terminal with
  `hc attach …`. `Copy` gives the command instead, falling back to selecting it
  when the clipboard is unavailable. Sessions with no evidence of a workstream
  are listed separately, never assigned by guesswork.
- **Reports** — structured feedback the factory consumed, with expected and
  actual text side by side.

The refresh button is deliberate: this is an observation surface, not a
controller. The only action is `POST /open`, which validates the address and
runs `rex block focus` or `hc attach`; factory state is never written here.
