# foreman

The foreman's durable fan-out harness. It is **not** a fifth tool — it drives the four, and it
lives outside `packages/` on purpose (FOREMAN.md, "How a human runs this", the _durable and
ambitious_ rung).

It exists because FOREMAN's task is a chain that does not end: `census → triage → dispatch →
witness → ratchet → learn`, repeated until the budget yields, resumed exactly where it stopped.
A prompt cannot hold that chain across a crash. This can.

## Shape

```
tools/foreman/
├─ src/
│  ├─ store.ts      the durable memory: documents + the round's task chain (node:sqlite)
│  ├─ budget.ts     the governor: reads the opencode meter, decides whether to start work
│  ├─ dispatch.ts   the hands: `opencode2 run --format json`, one child conversation
│  ├─ round.ts      the chain: seed a plan, dispatch pending tasks under the budget
│  └─ main.ts       the front door: status / seed / run / dispatch
└─ budget.json      the committed Budget (FOREMAN §9: a document, not a feeling)
```

It is dependency-free by design — Node built-ins only (`node:sqlite`, `node:child_process`) —
so `node tools/foreman/src/main.ts` runs the source directly, no build step. The `pi-durable`
harness FOREMAN sketches (`Harness.open`, `NodeExecutionEnv`) is **not present in this
environment**; this is the OpenCode-V2 equivalent of it, built on the surface that is here.

## Use

```sh
pnpm foreman status                     # what the last round left behind; may we dispatch?
pnpm foreman seed --file plan.json      # record a plan's tasks as `pending`
pnpm foreman run                        # dispatch the pending chain until the budget yields
pnpm foreman run --dry-run              # show what would run, spend nothing
pnpm foreman dispatch --request-id X --phase witness --role witness --prompt "…"
```

## What it guarantees

- **Durability.** Every task is a row keyed by `requestId` (derived from the finding it works
  on), so a restart never redoes a done thing (§5.3).
- **Honesty about interruption.** A task left `running` by a crash is _reported_, never
  silently repeated — dispatch is not replay-safe (§Appendix).
- **The budget is a gate, not a feeling.** `run` and `dispatch` ask `budget.ts` before they
  reach a model; a ceiling stops work from starting and lets in-flight work finish (§9).
- **One model, many briefs.** Every child is `deepseek-v4.1-flash`; the free line goes first.
  Differentiation is evidence and authority, never the weights (§6).

## Not yet

- The `defineTask` round chain is generic: every phase is a dispatched conversation or a
  `role: "self"` step. The in-process `witness`/`ratchet` helpers (run the judge, move the
  baseline) are still done by hand in a round, not yet by the harness.
- Worktrees: `dispatch --worktree <dir>` runs a child in a worktree, but the harness does not
  create or merge one yet.
- The harness is scoped out of the root lint (`tools/**`) for now; holding it to the same
  rules is a Phase-B item.
