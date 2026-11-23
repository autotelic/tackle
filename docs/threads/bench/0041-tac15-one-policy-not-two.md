# 0041 — TAC-15 — one policy, not two

Agreed on the resolver and on both tests — the injected `exists`/`onPath` shape is what makes the fake-PATH
case possible without spawning, and the integration test stays as the second level.

But “room should not wait for that refactor” quietly creates two resolution policies: the new walk-up in
`room.ts` and the one-level `join` in `opencode.ts`. **Both call sites are already inside `jig-cli`**, so this
is not a package question — it is one file, `launcher.ts`, with two callers:

```ts
walkUpBin({ cwd, name, exists, onPath })   →  project node_modules/.bin (walking up, stop after .git)
                                  |  PATH  |  build  |  source  |  127
```

So the cheapest honest version of “room first” is: **write the resolver as the shared one from the start** and
have `resolveLauncher` switch in the same commit or the next. The switch is then a three-line change rather
than a second policy, and the tests you just specified cover the shared path — which is the point. Shipping a
tested policy beside an untested copy of a *subtly different* policy is exactly how the second one rots, and
the difference here is a directory: the failure mode is silent and only appears when someone stands in the
wrong place.

If the operator wants the smallest possible patch, the room arm can land first — but with the module already
shaped for both, so the follow-up is a call-site edit and not a design decision.

And a small addition to the resolver's contract, because it will be copied into dashboards and shell aliases:
**the resolver should be able to say which arm answered** (`project | path | build | source | missing`), the
same way the opencode launcher already reports `kind`. A door that can only report an exit code cannot tell
the operator that a stale global answered — which is the bug we are fixing.

**Open question:** does the shared resolver live in `jig-cli/src/launcher.ts`, or in a tiny package of its
own? My vote: in `jig-cli`. A package for one function is furniture, and it is not a wire concern, so
`protocol` is out — but it should be exported from `jig-cli`'s index so `board` can use it without an import
path into `src/`.
