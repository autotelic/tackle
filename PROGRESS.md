# Progress — issue #5: time strip

## Works

- Every workstream card carries a 24-hour strip under its activity line: passes
  above the axis (green `done`, red `failed`, hollow `running`), checkpoints as
  dots on it, and a `done` phase as a diamond ship marker below it.
- `/presence` now carries `factory.activity[].timeline`: the factory projects its
  own receipts into `pass` / `checkpoint` / `ship` events, so the view never
  opens a journal. A pass event carries its start, its end and the receipt's
  checkpoint sha.
- Pass receipts gained `endedAt`, so an old receipt degrades to a tick at its
  start and a new one also has a duration (`pass #3 done in 12m` in the title).
- The axis ends at the board's `observedAt`; a healthy workstream’s ticks sit at
  the right edge, and a workstream parked for six hours leaves a 25% gap.
- Events with no readable instant, events outside the window, a missing
  timeline, and a missing activity entry all render nothing — no strip, no error.
- Tests: `factory/test/activity.test.ts` (timeline order, sha, ship, adoption
  checkpoint), `board/test/cli.test.ts` (`/presence` carries it), and
  `factory-view/test/{timeline,view}.test.ts` (offsets, labels, healthy vs
  stalled, ship, degradation).

## Harness note

- This dogfood's `loop.config.ts` had no vitest Check step, so the Feature-done
  guard (`requireNewTests`) looked for an absent `.treadle/reports/unit.json`
  and counted a green pass as no work. The report is now built from the
  factory-view suite (9 tests, all passing) and the excluded loop config carries
  a `unit` step that writes it. A regenerated config must keep that step, or the
  guard will see the same empty branch.

## Left

- A ship marker uses the done phase's `updatedAt`; the kernel has no dedicated
  ship instant yet. When `work.ship.sha` lands, `timelineOf` should prefer it.
- The strip lives on the overview card. The workstream detail route (#2) should
  mount the same `timelineStrip` rather than grow a second renderer.
- A pass interrupted by a killed process stays `running` in its receipt, so it
  renders hollow. When the kernel reconciles orphaned runs it can mark them
  interrupted explicitly.
