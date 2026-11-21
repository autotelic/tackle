# Mailbox conformance debt

**Deadline: C6.** `jig check` exits 1 on this package until every row is zero. Nothing here is
baselined: a baseline would make the debt invisible, which is the failure this ledger exists to
prevent.

## Fixed in C2c

- **Clock in the core.** `appendTurn` and `exportDirectory` took their instant from
  `Date.now()`/`new Date()`. Both now require `at` from the caller; the CLI mints it at the
  process boundary. Two findings closed.
- **False positive narrowed.** `plumb/no-sql-string-interpolation` read the turn-file error message
  in `log.ts` as a query. The rule is off for that one file, with the reason in `oxlint.config.ts`.

## Carried (28 findings)

| rule                                         | severity | count | files                                                                                            |
| -------------------------------------------- | -------- | ----- | ------------------------------------------------------------------------------------------------ |
| `no-reinterpret-cast`                        | error    | 6     | packages/mailbox-domain/src/procedures.ts, packages/mailbox-server/test/fixtures.test.ts, cli.ts |
| `require-safety-comment-for-type-assertion`  | error    | 5     | packages/mailbox-domain/src/procedures.ts, packages/mailbox-server/test/fixtures.test.ts         |
| `plumb-effect/guarded-op-must-return-option` | error    | 3     | packages/mailbox-domain/src/procedures.ts, log.ts                                                |
| `no-unsafe-dictionary-type`                  | error    | 2     | packages/mailbox-domain/src/procedures.ts                                                        |
| `prefer-property-tests`                      | warn     | 2     | packages/mailbox-server/test/fixtures.test.ts, render.test.ts                                    |
| `require-sort-comparator`                    | error    | 2     | packages/mailbox-domain/src/procedures.ts, export.ts                                             |
| `eslint/no-unused-vars`                      | warn     | 1     | render.test.ts                                                                                   |
| `no-multiple-function-params`                | error    | 1     | packages/mailbox-domain/src/procedures.ts                                                        |
| `no-runtime-typeof`                          | error    | 1     | packages/mailbox-domain/src/procedures.ts                                                        |
| `no-stacked-jsdoc-blocks`                    | error    | 1     | render.ts                                                                                        |
| `no-swappable-primitive-params`              | error    | 1     | packages/mailbox-domain/src/procedures.ts                                                        |
| `no-unknown-parameters`                      | error    | 1     | packages/mailbox-domain/src/procedures.ts                                                        |
| `plumb-effect/no-manual-field-guards`        | warn     | 1     | log.ts                                                                                           |
| `plumb-effect/prefer-tagged-enum`            | error    | 1     | packages/mailbox-domain/src/procedures.ts                                                        |

## Why these are not fixed here

C3 is the first proof of the replacement. These are mechanical but touch the whole mailbox surface;
doing them inside the bench model commit would mix two risks. The deadline is the mailbox host
milestone (C6), where the same files are rewritten against Rat King's fixtures anyway.

## How to read it

```sh
node --conditions=development packages/jig-cli/src/cli.ts check --format json \
  | jq '[.diagnostics[] | select((.location.file // "") | contains("mailbox"))] | length'
```
