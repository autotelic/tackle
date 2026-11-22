# VISION — the factory view

One page that shows the software factory's state and gets a human to the session doing the work. Opened from a
phone on the tailnet as often as from the laptop.

## The shape: concentric panels

```
repo      acme/web            gate · workstreams · open PRs · unobserved count
  work    perms-1862          phase · checkpoint age · budget · PR · Linear project · desk
    sess  t1d (herdr)         what it is doing, what it is waiting on, a copyable attach command
    art   PR 1862             a link out, never embedded
```

A panel is **a filter, not a page**: `/factory/repo/:owner/:name` and `/factory/workstream/:id`, so a panel can be
shared in a message.

## What it must show

- **ages everywhere.** `checkpoint 12m ago`, `observed 3m ago`, `no checkpoint yet`. Never `0m`, never a number
  without its denominator.
- **freshness per source:** `fresh · stale · unobserved`, because “nobody looked” is not “nothing happened”.
- **three closed flags, kept separate:** `phase: done` (kernel), `pr: merged` (GitHub), `project: completed`
  (Linear). The disagreements are the useful state — `phase done · PR open` means ready for a person.
- **a time strip per workstream:** passes as ticks, checkpoints as dots, ships as markers, so “is this moving?” is
  answerable in a second.

## What it must not do

- no POST that runs a command (the address would be argv; an exec endpoint behind the tailnet is a shell with a web
  front end);
- no source of truth of its own — every field on screen comes from the documents it reads;
- no terminal emulation, no diff rendering, no editing: those have homes.

## Done means

- served at `/factory` by `board up`, working over `https://<machine>.<tailnet>.ts.net/factory` on a 390px phone;
- grouping, workstream detail, sessions with a copyable attach command, freshness, and the time strip all present;
- `jig check` green and the view's build green, with tests for the three freshness values and the null-checkpoint
  rendering;
- no field in the UI that is not in the JSON it renders.