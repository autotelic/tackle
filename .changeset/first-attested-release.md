---
"@autotelic/board": patch
"@autotelic/room": patch
"@autotelic/joggle": patch
"@autotelic/plumb": patch
---

First release published through npm's trusted publisher, so these tarballs carry a provenance
attestation like the rest of the family.

Every earlier version was uploaded with a token from a maintainer's machine. Provenance is the
record of which repository and workflow built the tarball; `npm audit signatures` can check it,
and it is the one thing a token-based publish cannot produce.

`@autotelic/board` also declares `sideEffects: false`: it is Effect schema definitions and
nothing else, so a bundler may drop what a reader never uses.
