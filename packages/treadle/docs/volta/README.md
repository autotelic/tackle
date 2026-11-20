# Volta incident notes

Incident notes from Loop runs, written to inform the implementation of **Volta** — the supervision layer that watches agent runs for _the turn_ (octave → portal/stall → volta → done) and decides whether to continue, nudge, fork (seconda volta) or stop and ask a person. Its design doc is `ideas/Volta.md` in the vault; its vocabulary is the vault's Pattern Language. The channel was started by the first overnight run's writeup (`docs/overnight-2026-11-06.md`).

One note per incident worth learning from: what happened, the extracted evidence (not vibes), the honest verdict, and the design candidates it feeds.

## Candidates so far

| Candidate                                                               | From                            | Status                          |
| :---------------------------------------------------------------------- | :------------------------------ | :------------------------------ |
| Stacked-PR maintenance (rebase/retarget/done after merges)              | overnight run's biggest finding | ✅ built (`src/maintenance.ts`) |
| Nudge before a budget is spent (turn-fraction pressure)                 | 2026-11-09 turn-cap exploration | open                            |
| Seconda volta: checkpoint + distilled handoff, retry the ending         | 2026-11-09 turn-cap exploration | open                            |
| Calibrated budgets per repo/task-kind, not one global cap               | 2026-11-09 turn-cap exploration | open                            |
| Octave-depth metric: writes fraction of tool calls as an in-pass signal | 2026-11-09 turn-cap exploration | open                            |
| Infra-failure classifier drift watch (`src/loop/provider.ts`)           | overnight Volta note            | open                            |

## Notes

- [2026-11-09: a good octave, killed one step into the deliverable](./2026-11-09-turn-cap-exploration.md)
