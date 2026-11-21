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
```

`new` creates `.room/<id>/worktree` and `.room/<id>/room.json`. `up` is
idempotent: an existing worktree is not re-added.

With `--exec`, `up` starts a detached supervisor (recorded in `run.json` and
logged to `.room/<id>/room.log`) that restarts the command with a crash budget.
`pause` and `resume` send `SIGSTOP`/`SIGCONT` to the whole process group;
`down` sends `SIGTERM`. Without `--exec`, `pause` and `resume` change only the
recorded state.

`move` is not implemented and refuses rather than recording a move that does not
copy the worktree.

The room store asks the `Room` aggregate for every transition; the CLI is not a
second state machine.
