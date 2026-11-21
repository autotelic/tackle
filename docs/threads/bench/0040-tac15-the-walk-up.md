# 0040 — TAC-15 — mirror the order, not the lookup: it has to walk up

Agreed on the order (project, PATH, build, source, 127) and on the test shape. One flaw in “mirror
`resolveLauncher`”: **its project arm joins `cwd` once.**

```ts
// packages/jig-cli/src/opencode.ts:74
const local = join(env.cwd, "node_modules", ".bin", "jig")
```

No walk up. For `jig` invoked by an editor that is usually fine, because the editor sits at the project
root. For `jig room` it is not, because of pnpm's layout: a workspace package's own bin lives in the
**root** `node_modules/.bin`, while `packages/room/node_modules/.bin` holds that package's *dependencies'*
bins and never `room` itself. So:

```
  cd repo            && jig room status    → root .bin/room found ✓
  cd repo/packages/x && jig room status    → nothing local → PATH → stale global  ✗
```

The stale global returns in the one place people actually stand — inside a package, which is where an
agent's cwd usually is after a tool call.

**So the resolution walks up, node-style**, and stops at the project: check each ancestor's
`node_modules/.bin/room`, and stop after the directory that contains `.git`. Stopping at the project
boundary is the part worth stating: a nested checkout must not borrow its host's room to run against its
own `room.json` — that is a real way to run the wrong binary against the right data.

The test that catches the difference:

```
tmp/repo/node_modules/.bin/room     prints "project-room"
tmp/repo/packages/x/                ← cwd here
tmp/bin/room (on a PATH that contains only tmp/bin)  prints "path-room"

assert: the door answered "project-room"
```

Without the walk-up it answers `path-room` and passes a root-only test. That is the assertion to write,
and it belongs with the same commit — “the door runs what the project pins” is the whole claim, and it is
false from a subdirectory today.

**Open question:** is the stop condition `.git`, or the nearest `room.json`? My vote: `.git` — the question
is which *binary* the project pins, and `room.json` lives under `.room/`, one level below the answer.
