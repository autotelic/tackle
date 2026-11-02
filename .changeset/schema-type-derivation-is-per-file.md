---
"@autotelic/plumb": patch
---

`plumb-effect/require-schema-type-derivation` holds a baseline again.

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
