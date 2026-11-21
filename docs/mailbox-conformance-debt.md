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

## Carried (38 findings)

| rule                                                         | severity | count | files                             |
| ------------------------------------------------------------ | -------- | ----- | --------------------------------- |
| `no-runtime-typeof`                                          | error    | 6     | log.ts                            |
| `no-conditional-empty-object-spread`                         | warn     | 4     | append.ts, cli.ts, log.ts         |
| `no-unsafe-dictionary-type`                                  | error    | 4     | log.ts                            |
| `require-jsdoc-on-exported`                                  | error    | 4     | log.ts, render.ts, tid.ts         |
| `plumb-effect/no-try-catch`                                  | error    | 3     | cli.ts, log.ts                    |
| `require-sort-comparator`                                    | error    | 3     | cli.ts, export.ts, render.test.ts |
| `no-reinterpret-cast`                                        | error    | 2     | cli.ts, log.ts                    |
| `no-unknown-parameters`                                      | error    | 2     | log.ts                            |
| `plumb-effect/prefer-effect-predicate-over-boolean-function` | error    | 2     | log.ts, tid.ts                    |
| `require-safety-comment-for-type-assertion`                  | error    | 2     | cli.ts, log.ts                    |
| `eslint/no-unused-vars`                                      | warn     | 1     | render.test.ts                    |
| `no-known-value-widening`                                    | error    | 1     | append.ts                         |
| `no-multiple-function-params`                                | error    | 1     | tid.ts                            |
| `no-swappable-primitive-params`                              | error    | 1     | tid.ts                            |
| `plumb-effect/guarded-op-must-return-option`                 | error    | 1     | log.ts                            |
| `prefer-property-tests`                                      | warn     | 1     | render.test.ts                    |

## Why these are not fixed here

C3 is the first proof of the replacement. These are mechanical but touch the whole mailbox surface;
doing them inside the bench model commit would mix two risks. The deadline is the mailbox host
milestone (C6), where the same files are rewritten against Rat King's fixtures anyway.

## How to read it

```sh
node --conditions=development packages/jig-cli/src/cli.ts check --format json \
  | jq '[.diagnostics[] | select((.location.file // "") | contains("mailbox"))] | length'
```
