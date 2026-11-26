# @autotelic/board

## 0.0.2

### Patch Changes

- Two fixes that made a workstream report a state nobody was in:

  - `activityOf` asked the receipt whether a pass was running. A receipt is written
    by the process it describes, so a pass whose writer died -- a `daemon stop`
    mid-pass, a hard exit -- left the word `running` on disk forever and
    `factory ready` refused with `ReadyBlocked: pass running` against nothing. It
    now asks the process, through the same `runningPass` check the pass lock
    already used.
  - the board's test run discovered `view/test/**`, which belongs to the separate
    `@autotelic/board-view` package, and failed both suites with "Vitest failed to
    find the current suite". `pnpm check` was therefore red on trunk for every
    workstream, so the declared landing gate could never go green. The board now
    runs `test/` only.

## 0.0.1

### Patch Changes

- Updated dependencies [260ee08]
  - @autotelic/protocol@0.1.2
