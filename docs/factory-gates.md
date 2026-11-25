# Factory gates: pass vs landing

Conformance is a landing gate, not a per-pass tax.

## Record shape

```json
{
  "gates": {
    "perPass": [
      {
        "name": "touched test",
        "command": "pnpm exec vitest run services/rest/test/projectFileRead.test.js"
      }
    ],
    "onReady": [
      { "name": "jig", "command": "./node_modules/.bin/jig check --pr-number 1875 --format json" },
      { "name": "joggle", "command": "./node_modules/.bin/joggle check --pr-number 1875" },
      { "name": "spec", "command": "node scripts/spec-check.mjs" }
    ]
  },
  "readiness": {
    "at": "2026-11-24T20:00:00.000Z",
    "ok": true,
    "checks": []
  }
}
```

- `gates.perPass` is guidance for the worker: the touched test, changed-file lint and
  TypeScript checks. It is cheap and proves the ticket.
- `gates.onReady` is the landing tier. It runs once at the PR head, through `factory ready`.
- `readiness` is the durable result: `ok`, each command's exit, duration, and output tail.
- The commands are data, not kernel guesses. A repo can change its conformance command without a
  factory release, and a jig pin can no longer change the meaning of "measured" by accident.

## Behaviour

```sh
factory ready --id projects-list-1862
```

- green: workstream moves to `land`, the PR is marked ready for review, and one "Ready for review" desk is raised; merging is a separate human act
- red: workstream stays in `build`, one "Landing gate failed" desk names the command and output
- no `onReady` gates: refuses with `NoOnReadyGates`

Landing is serialised per workstream and globally by the landing lock. `factory ready` refuses
when the **target** workstream has a live pass, or when another ready is already running; an
unrelated workstream may keep building. The suite reads its own worktree, and the landing gate
owns the shared test database.

The landing gate owns shared external services. Bring the test database up once and leave it
running for the whole landing. A test suite must not stop a shared database in `afterAll` while
another request is in flight; that produces an admin-termination 500 and a teardown cascade,
which is infrastructure noise, not a query failure.

A normal pass no longer measures jig/joggle before and after. Its receipt records
`available: false`, `complete: false`, and `note: "not measured (conformance is a landing gate)"`.
That is the honest state; the landing gate is where the measurement belongs.

## Review responses

A pending PR review or comment overrides the phase. The pass reads the threads, addresses every
unresolved comment with one coherent commit per thread, pushes, and replies in the thread with the
commit sha and what changed. It resolves the thread where the host permits. A decision is derived
from the SOW and code and stated in the reply; it does not become a desk card. If a comment cannot
be addressed, the pass replies with the reason and stops instead of committing unrelated work. It
does not re-run landing and does not merge.

## The jig rung contract

When `jig.config.json` declares the joggle process engine, its `args` must **not** repeat the
`check` subcommand. jig prepends `check --format json`; a config that also starts with `check`
produces `check ... check ...`, and joggle exits 3 without looking at the branch.

Until the fixed jig is published, a landing run may use the individual engines directly
(`joggle check --pr-number`, plumb via oxlint, cutlist, spec-check, policy sync) and leave the
composite jig check to CI. Do not call that a jig pass. The composite gate is the thing being
repaired, not the thing that earns the green.

## Why

The per-pass measurement was both the largest tool-time cost and a source of false confidence:
the scope depended on the jig version, inherited findings were read as this pass's failure, and a
draft PR's skipped CI was neither green nor red. The pass owns the ticket and the commit; the
landing gate owns the PR's conformance.
