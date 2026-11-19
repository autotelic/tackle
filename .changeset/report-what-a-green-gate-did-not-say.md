---
"@autotelic/jig-cli": patch
---

Say what a green gate did not answer.

Three additions to the text report, each from the same question: which reading of "0 findings"
is this?

- The headline now carries the unjudged count (`… ; 11,946 candidate(s) not judged`). A judged
  rule whose model key was absent has not assessed the architecture, and the per-engine note
  was too easy to scroll past.
- A scoped run says how many findings it read outside its change set (`412 finding(s) outside
  this scope, not shown`). `--pr` narrows to the files the pull request touched; a cross-file
  finding filed on an older file is then invisible, so the scoped number is a floor, not the
  repository's answer.
- The gate names the rules that are reported and cannot fail it (`2,112 finding(s) reported and
  cannot fail this gate (failOn: error): …`). A warning under `failOn: error`, a baselined
  identity, and an advisory engine are all displayed like enforced findings and are enforced by
  nothing; a repository keeping a second, errors-only lint config can now see which rules live
  only there, without diffing two JSON files.
