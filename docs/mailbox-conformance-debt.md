# Mailbox conformance debt

**Zero.** `jig check` reports no diagnostics in `packages/mailbox`, `packages/mailbox-domain`
or `packages/mailbox-server`. Nothing is baselined. The few rule narrowings are named in
`oxlint.config.ts` with their reasons: a wire enum is not a local dispatch tag, a boundary
predicate takes unknown, did:web is a plain read, a fixture suite is not a property suite.

## Fixed in C2c

- **Clock in the core.** `appendTurn` and `exportDirectory` took their instant from
  `Date.now()`/`new Date()`. Both now require `at` from the caller; the CLI mints it at the
  process boundary. Two findings closed.
- **False positive narrowed.** `plumb/no-sql-string-interpolation` read the turn-file error message
  in `log.ts` as a query. The rule is off for that one file, with the reason in `oxlint.config.ts`.

## Carried (0 findings)

| rule | severity | count | files |
| ---- | -------- | ----- | ----- |

## Why these are not fixed here

C3 is the first proof of the replacement. These are mechanical but touch the whole mailbox surface;
doing them inside the bench model commit would mix two risks. The deadline is the mailbox host
milestone (C6), where the same files are rewritten against Rat King's fixtures anyway.

## How to read it

```sh
node --conditions=development packages/jig-cli/src/cli.ts check --format json \
  | jq '[.diagnostics[] | select((.location.file // "") | contains("mailbox"))] | length'
```
