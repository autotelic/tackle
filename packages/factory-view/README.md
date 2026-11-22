# @autotelic/factory-view

The software factory's view: one page that shows every open workstream, its
phase, its checkpoint, the pending desk item, the sessions that can open it, and
the reports the factory has consumed.

It is a Foldkit application. State arrives as one `/presence` read; every
transition is a message, and the UI has no local source of truth.

## Shape

```
/presence  ──decode──▶  Presence
                         ├─ factory.workstreams  id, project, phase, pr, checkpoint
                         ├─ factory.desk         id, title, workstream
                         ├─ factory.reports      kind, workstream, expected, actual
                         └─ sessions             herdr / rex addresses
```

The view never imports `board` or `factory`. The JSON is the seam; the local
schema is the wire contract.

## Run it

The board serves the built view at `/factory`:

```sh
pnpm --filter @autotelic/factory-view build
board up --root .room --port 4780
open http://127.0.0.1:4780/factory
```

For UI work, run Vite with the board already up:

```sh
pnpm --filter @autotelic/factory-view dev
# http://127.0.0.1:4782/ — proxies /presence to 4780
```

## What each row means

- **Workstreams** — one row per adopted workstream. `phase` is the kernel's
  state (`reconcile`, `build`, `land`, `blocked`, `done`); `checkpoint` is the
  commit the last pass stopped at.
- **Desk** — questions waiting for a human. The view does not answer them; it
  shows which workstream asked.
- **Sessions** — Herdr and Rex addresses. `Open` asks the board to focus the
  session in its app: a Rex block is focused by block id, and a Herdr terminal
  is attached in Terminal with `hc attach …`. `Copy` gives the command instead.
- **Reports** — structured feedback the factory consumed, with expected and
  actual text side by side.

The refresh button is deliberate: this is an observation surface, not a
controller. The only action is `POST /open`, which validates the address and
runs `rex block focus` or `hc attach`; factory state is never written here.
