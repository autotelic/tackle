# Changesets

Every package under `packages/` is versioned and published **independently**.

- `pnpm changeset` — describe a change and pick the packages it affects.
- `pnpm version` — apply version bumps and changelogs.
- `pnpm release` — build and publish the changed packages.

Dependency law means a breaking change to `@autotelic/protocol` bumps every
engine that reads it; changesets surfaces that via `updateInternalDependencies`.
