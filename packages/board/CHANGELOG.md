# @autotelic/board

## 0.1.0

### Minor Changes

- e12d0f1: Publish the board alongside the room. `@autotelic/room` already depends on these records, and a
  published room cannot point at an unpublished dependency; the package also gains a `files` list
  so the tarball is `dist`, not the source tree and its tsconfigs.
