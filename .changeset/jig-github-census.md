---
"@autotelic/jig-cli": patch
---

`--format github` carries the census. An engine that skipped a rule, left candidates unjudged, or
replayed found _nothing to say_, which is not the same as nothing to find — and the annotations
used to drop all of it, so a CI step could print no annotations at all and exit 0 while the rules
it exists to run never looked. Each such engine now emits
`::warning title=jig census (<engine>)::<why>` before its findings.
