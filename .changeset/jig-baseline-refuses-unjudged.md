---
"@autotelic/jig-cli": minor
---

jig baseline refuses findings no judgement reached (`--allow-unjudged` overrides), and names
TYPESAFE_API_KEY as what judges them: without one the same findings are named from what the
rules could see alone, so a ledger written locally does not match a judged run and passes here
while failing CI.

It also checks its own postcondition. The ledger decides novelty alone, so under
`failOn: warn|error` or a `maxWarnings` ceiling the gate holds by severity and cannot be
cleared by accepting findings; baseline now says which regime held and exits with `check`'s
code instead of printing success over a red gate.

`--format github` annotates identities the ledger already accepts as `::notice` rather than
`::error`, and always emits the gate's own line, so an accepted finding is never the last red
line in a CI log.
