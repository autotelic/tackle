# Progress — issue #4: freshness

## Works

- Every panel carries an age and a `freshness` value (`fresh`, `stale`,
  `unobserved`), rendered with distinct badges. Workstreams show their three
  sources (`github`, `linear`, `reports`) separately, so a quiet source cannot
  hide behind a fresh one.
- Ages use seconds under a minute (`observed 4s ago`), never a truncated `0m`.
  A null or missing checkpoint renders `no checkpoint yet`.
- The page tracks its own poll instant. A failed poll clears `/presence`, shows
  a `feed lost` banner with the failure and the last good read, and the header
  says `poll failed …` instead of leaving the last frame looking current.
- `packages/factory-view/src/presence.ts` is the wire contract; it accepts a
  null checkpoint, missing cursors, and an older board without those fields.
- The view's build now runs its tests (`vitest run && vite build`), matching the
  other packages so the loop's `view-build` check exercises them.

## Tests

- `test/freshness.test.ts` covers the three freshness values, the exact
  threshold, sub-minute ages, and `no checkpoint yet`; fast-check covers the
  age and threshold invariants.
- `test/view.test.ts` renders the real Foldkit view: all three freshness badges,
  per-source freshness, the null-checkpoint line, page poll age, and the
  lost-feed state (which must not leave the last workstream name on screen).

## Next

- Time strip (#5) can read `checkpoint.at` and the report `at` fields already on
  the document; nothing in this change adds a second data path.
