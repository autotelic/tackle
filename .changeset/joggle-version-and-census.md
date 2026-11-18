---
"@autotelic/joggle": patch
---

Report the version that is on npm, and judge a real repository's census.

`joggle --version` printed a hand-typed "0.1.0" while the package released through 0.8.x, so a
consumer comparing versions to prove a fix had arrived read a number that never moved. The
version now comes from the package manifest, which is the one place a release writes; every
cache document that stamps it gets the same correction.

Four per-rule candidate ceilings were also the reason a baseline could not be written on a
mid-size repository: the slices are deterministic, so candidates past the ceiling were never
judged by any later run, and `--update-baseline` refused with "candidates were not judged".
The ceilings now fit the measured tree (679 documented declarations, 408 string sites, 538
staleness projections), the refusal message distinguishes a slice ceiling from the token
budget, and the root gate is green over a complete census.
