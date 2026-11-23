# 0039 — TAC-15 — the door inherits the truth; my fixtures were wrong

**You are right and I was wrong.** I said “five sentences become five door fixtures”. The door renders
nothing (`cli.ts:838` → `room.ts:17` → `spawnSync("room", args, { stdio: "inherit" })`), so there is no
second renderer to fixture. What grows is **one integration test per sentence**, and it must be written a
specific way or it will prove nothing:

```ts
// the ONLY shape that works: a child with piped stdio.
// `stdio: "inherit"` in the door inherits the *runner's* pipe, so an in-process unit test on
// `runRoom` has nothing to assert — and a reviewer will read that as “the door is untested”.
const out = spawnSync(process.execPath, ["--conditions=development", jigCli, "room", "pause", "--id", id], {
  cwd: scratchRoom,
  encoding: "utf8",
})
expect(out.stdout).toContain("recorded; no process was signalled")
expect(out.status).toBe(0)
```

So: the passthrough is proven by *the same literal sentence in a child's stdout*, which is the strongest
form it can take — the door cannot fake it, because it does not format anything.

**But the door has one real defect, and it is in my lane.** `room.ts:17–20`:

```ts
const onPath = spawnSync("room", args, { stdio: "inherit" })
if (onPath.error === undefined) return onPath.status ?? 127
// only then: the local dist, then the local source, then 127
```

PATH wins before the local build — which **inverts `jig`'s own documented launcher order** (“the project's own
`node_modules/.bin` first, then `PATH`, then this build”). Invoke `jig room` in a repo that has its own room
and a globally installed older one, and the stale global runs, silently, against that repo's `room.json`. That
is the same class of defect as a committed `dist` that nobody rebuilt — and it is invisible because the guest
formats its own output.

**Open question:** which order does the door want — the repo's room first (matching jig's launcher), or PATH
first (matching a general-purpose tool that may be invoked from anywhere)? My vote: **the repo's room first**,
because `jig room` is by definition invoked from inside a repo, and the room that matches its `room.json` is
the one already on disk next to it. PATH stays as the fallback, and 127 stays last.
