# 0026 — TAC-15 — the table is almost jig's own, and one move contradicts a boundary

**Exit table: accepted, with three amendments.**

jig already publishes its slots in `packages/jig-cli/src/gate.ts`:

```ts
export const EXIT = { clean: 0, findings: 1, usage: 2, infrastructure: 3 } as const
```

Your table is the same four slots with slot 1 renamed from “findings” to “state refusal”. That is the
right unification — in both CLIs 1 means *the command ran and the answer is no* — and it is worth
saying in those terms, because the reason to adopt jig's names is that **`jig room` then maps nothing**.
A door that translates exit codes is a second implementation of the error model.

1. **Name the slots once:** `clean 0 · declined 1 · usage 2 · infrastructure 3`, in one shared place
   that room, board and jig import. Not three constants that agree today.
2. **A missing binary is `127`, passed through** — never remapped to 3. `jig room` must not disguise
   “not installed” as “your worktree broke”.
3. **A failure to decode the command's own input is never 1.** A malformed `room.config.json` or an
   unparseable `--json` request is `usage 2`; an unreachable filesystem is `infrastructure 3`. Only a
   command that reached the model and was refused earns 1 — otherwise an operator goes looking at the
   wrong thing, which is the whole failure class this repo keeps writing tools to avoid.

And the part your table does not say: **four wire errors cannot share one retry policy.**
`LeaseMismatch` → re-acquire and retry; `Conflict` → never retry; `Retired`/`RoleUnresolved` → stop and
find a human. Exit code 1 for all four is fine *only if* `--json` carries `{ name, kind, retry }` with
the wire name verbatim, and the code is a pure projection of `kind`. Write the table test that asserts
each name has exactly one `(kind, retry)` pair; that test is the contract, and it is what lets the exit
code stay coarse.

**Now the part I would stop for: moving `Worktree` into `room` contradicts the boundary you just stated.**
`Worktree.ts` runs `git worktree add`, archives a directory, touches the filesystem. Put it in
`packages/room/src/` and “domain purity stays in `src/Room`; the CLI is the only I/O edge” becomes false in
the same commit — and the next reader has no way to know which sentence is the real rule.

Two clean options, both defensible: **Worktree stays in `board`** (it is the host's data plane, and room
receives a port it declares), or **room declares a `Worktree` port in `src/` and board provides the
implementation**. What does not work is room *containing* the Git calls and room's `src/` staying pure.

**Open question:** does `move` need its own exit code for `Divergent`, given it is neither retryable nor
a plain refusal but a state that only a human can resolve? My vote: no — `kind: "divergent"`, `retry:
false`, exit 1 — because divergence already has a record and a desk item, and a fifth meaning in a slot
jig already owns is how two CLIs stop agreeing.
