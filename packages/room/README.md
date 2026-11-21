# room

One durable place per scope: a git worktree plus the control-plane state that names it.

## Commands

```sh
room new --repo ~/code/app --scope dev-1575
room status [--id dev-1575] [--json]
room up --id dev-1575
room up --id dev-1575 --exec 'pnpm dev'
room pause --id dev-1575
room resume --id dev-1575
room down --id dev-1575
room use --id dev-1575
room run --id dev-1575 -- pnpm test
```

`new` creates `.room/<id>/worktree` and `.room/<id>/room.json`. `up` is
idempotent: an existing worktree is not re-added.

With `--exec`, `up` starts a detached supervisor (recorded in `run.json` and
logged to `.room/<id>/room.log`) that restarts the command with a crash budget.
The command is remembered in `room.json`, so a later `room up --id <id>` with no
`--exec` starts the same command again.
`pause` and `resume` send `SIGSTOP`/`SIGCONT` to the whole process group;
`down` sends `SIGTERM`. Without `--exec`, `pause` and `resume` change only the
recorded state.

`room use` labels the current Herdr terminal with `room=<id>`, using
`HC_TERMINAL_ID` (Herdr injects it). It refuses if the variable is absent, and
verifies the terminal through `hc get` before labeling. `room up` never stamps a
terminal: it is idempotent and may run in CI or another agent's shell.

`room run` starts a child with `hc run --label room=<id> --cwd <worktree> -- <command>`,
so the child is labeled at spawn rather than after the fact.

`move` is not implemented and refuses rather than recording a move that does not
copy the worktree.

The room store asks the `Room` aggregate for every transition; the CLI is not a
second state machine.
