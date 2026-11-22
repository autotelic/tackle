# Factory panel

A native Herdr block: one row per factory workstream, ordered by what needs a
person, reading the board's `/presence` projection.

## What you see

A 320 px column on the right of the window, beside the panes: a `Factory`
header with the blocked count, the report count and a desk badge; then one row
per workstream — a state dot, the workstream label, a state badge, and a meta
line of repo, last pass, age, `used/cap` passes and queued events; then the desk
items; then Branch Issue / Branch PR when those mods are installed.

## How it behaves

- Reads `http://127.0.0.1:4780/presence` every 15 seconds, and only that. The
  JSON shape is the board's: this mod never re-declares it and never reads
  `~/.factory` directly. A mod is handed no HTTP client, so the read runs
  `curl` through the host's `exec`, as the shipped mods run `git`.
- One row per `factory.workstreams[]`, ordered by attention: blocked, working,
  queued, idle, done. A workstream with no `factory.activity[]` entry sorts
  last and shows no badge — a missing field renders nothing, it is not guessed.
- Every meta part is optional: repo, `pass N`, `Nm ago`, `4/20`, `2 queued` —
  each appears only when the projection sent it.
- **Focus** appears on a workstream only when `factory` matched it to a Herdr
  session _and_ the app still shows that terminal; it runs
  `agent.focus {terminal: address}`. One action, no Linear or PR internals.
- Desk items are the only questions: the header badge counts them, each item is
  one row, and both open the web view — the reading surface, and the only one at
  phone width.
- An unreachable `/presence` shows `offline` and no rows. Keeping the last good
  rows would report work as current while the board is down.

## Install

1. The mod folder:

   ```sh
   ln -sfn "$PWD/herdr/factory" ~/.config/herdr-app/mods/factory
   # or copy it, instead of symlinking:
   # cp -R herdr/factory ~/.config/herdr-app/mods/factory
   ```

   `mod.json` says `"place": "none"`, so Herdr does not dock a copy by itself:
   the layout below is what shows it. Drop `preview.png` here if you make one.

2. A layout with the block. Herdr's own `main` is read-only — it is replaced on
   every start — so clone it and add the panel to the clone:

   ```sh
   herdr-app do layout.clone '{"name":"main","as":"factory"}'
   ```

   In `~/.config/herdr-app/layouts/factory.json`, add a third narrow panel to
   `work-body.children`, after `panel`:

   ```json
   {
     "id": "factory",
     "type": "block",
     "hidden": true,
     "size": { "px": 320 },
     "min": 260,
     "max": 640,
     "content": { "mod": "factory" }
   }
   ```

   Nothing from `main` is replaced: spaces, agents, tabs, panes, Files and
   Changes all stay, and the factory panel is one more column, hidden until the
   key shows it.

3. The key, merged into `~/.config/herdr-app/keys.json`:

   ```json
   {
     "layout:factory": {
       "cmd-shift-f": { "command": "layout.toggle", "args": { "id": "factory" } }
     }
   }
   ```

   `layout:factory` binds it only while that layout shows. Pick another key if
   `cmd-shift-f` is taken; `ctrl-shift-f` is the terminal's search.

4. Check it:

   ```sh
   herdr-app check herdr/factory   # or ~/.config/herdr-app/mods/factory
   ```

   Then `ctrl-shift-l` until the `factory` layout shows, and `cmd-shift-f` to
   show and hide the panel. The board must be up: `board up` binds
   `127.0.0.1` by default, and `board up --host <tailnet address>` binds the
   loopback listener beside it, so the panel needs no configuration of its own.

## Watch out

- Saving a file through the symlink does not always wake Herdr's watcher; switch
  layouts (`ctrl-shift-l`) to start the mod copy fresh.
- The panel trusts `/presence` for workstream facts and the app for live
  addresses: a session the projection still lists but the app no longer shows
  gets no Focus button.
- `herdr-app check` renders the offline state only — it does not wait for the
  fetch. Looking at it in the app is the check that covers the rows.

## Uninstall

```sh
rm ~/.config/herdr-app/mods/factory
rm ~/.config/herdr-app/layouts/factory.json
```

Then drop the `layout:factory` section from `keys.json`.
