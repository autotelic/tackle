# @autotelic/board

## 0.1.1

### Patch Changes

- da20164: First release published through npm's trusted publisher, so these tarballs carry a provenance
  attestation like the rest of the family.

  Every earlier version was uploaded with a token from a maintainer's machine. Provenance is the
  record of which repository and workflow built the tarball; `npm audit signatures` can check it,
  and it is the one thing a token-based publish cannot produce.

  `@autotelic/board` also declares `sideEffects: false`: it is Effect schema definitions and
  nothing else, so a bundler may drop what a reader never uses.

## 0.1.0

### Minor Changes

- e12d0f1: Publish the board alongside the room. `@autotelic/room` already depends on these records, and a
  published room cannot point at an unpublished dependency; the package also gains a `files` list
  so the tarball is `dist`, not the source tree and its tsconfigs.
