# @autotelic/plumb

## 0.6.2

### Patch Changes

- da20164: First release published through npm's trusted publisher, so these tarballs carry a provenance
  attestation like the rest of the family.

  Every earlier version was uploaded with a token from a maintainer's machine. Provenance is the
  record of which repository and workflow built the tarball; `npm audit signatures` can check it,
  and it is the one thing a token-based publish cannot produce.

  `@autotelic/board` also declares `sideEffects: false`: it is Effect schema definitions and
  nothing else, so a bundler may drop what a reader never uses.

## 0.6.1

### Patch Changes

- a4139bf: `plumb-effect/require-schema-type-derivation` holds a baseline again.

  Two defects made it unusable on a real tree, and both are fixed:

  - its `createOnce` visitor kept the schema map across files, so an interface in `b.ts` was
    reported against a schema declared in `a.ts` -- at line 1, column 1, citing a name the file
    does not contain -- and the same tree answered 33/39/40 findings run to run. The maps are
    now emptied in `before`, which is the per-file hook `createOnce` provides.
  - it never read the `extends` clause, so `interface X extends Schema.Type<typeof XSchema>`
    -- the fix the rule asks for -- was reported as a hand-written twin. A heritage clause is
    now skipped.

  The rule is re-enabled at its normal severity in the root and `packages/joggle` configs,
  where it measures zero findings over repeat runs, so a regression is caught by this repo's own
  ratchet instead of an adopter's. `no-raw-error-forwarding` clears its catch stack in `before`
  for the same invariant.
