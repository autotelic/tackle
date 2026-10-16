# Report projections

`protocol` does not render. This file **specifies** how a host maps a `report` record into
the standard shapes other tools read, so a finding can leave the workspace without a second
finding shape being invented. The implementations live in a rendering host (`jig`), not
here; the worked examples under `fixtures/projections/` are what keeps this spec honest, and
`src/projections.test.ts` checks them.

## Priority

Not every target deserves the same care. A top format designer would say so:

1. **SARIF 2.1.0** is the load-bearing one. It is the OASIS interchange for static
   analysis, and it is what GitHub code scanning, most security tooling, and most IDEs
   ingest. If only one projection ships, it is this one.
2. **LSP 3.17 diagnostics** is the editor contract. Cheap once the report exists, and the
   difference between "run `jig`" and "see squiggles".
3. **Code Climate issue JSON** is one CI dashboard's private shape. Worth emitting for
   convenience, and the least principled of the three: it is a vendor format with no
   schema, and it should never constrain the report's design. **Generate it; do not depend
   on it.**

The report is the truth. A projection is a _rendering_: if a target cannot express
something the report says, the information is dropped, not bent back into the report.

## Common rules

- One output entry per `diagnostics` entry, in report order. The order is already total
  (severity, file, line, column, rule), so a projection never re-sorts.
- The finding's stable name is `${engine}/${ruleId}` — the same string in every target, so
  a host's suppression list does not depend on which target it speaks.
- The location is `location.file`, `location.line`, `location.column`, and the optional
  `endLine`/`endColumn`. Nothing is re-derived from the source; the projection reports what
  the engine measured.
- The projection carries the record's own version outward: `report.lexicon.version` (1)
  is what a consumer sees as the format version, so it can tell which protocol emitted a
  result without guessing.
- A projection **may** be given the accepted baseline (a `baseline` record, or the `known`
  half of a `BaselineDiff`). When it is, every entry says whether the finding is `novel` or
  `known`, and a `known` finding is marked _suppressed_ rather than hidden — the reviewer
  sees accepted debt grayed out, not deleted. Without a baseline, no entry carries the
  annotation.

## SARIF 2.1.0

```
report                                  sarif.runs[0]
  .lexicon.version                        .tool.driver.version  (as a string)
  .diagnostics[]                          .results[]
    ${engine}/${ruleId}                     .ruleId, and one .tool.driver.rules[] entry
    severity error|warn|info               .level  error|warning|note
    message                                 .message.text
    help (optional)                         .tool.driver.rules[].help.text
    docsUrl (optional)                      .tool.driver.rules[].helpUri
    fixable (optional true)                 .properties.fixable
    location.file                           .locations[0].physicalLocation.artifactLocation.uri
    location.line/column/endLine/endColumn  .locations[0].physicalLocation.region.startLine/
                                            startColumn/endLine/endColumn
```

`version` is `"2.1.0"` and `$schema` is the published SARIF 2.1.0 schema URL. `tool.driver.name`
is the host's name, and `tool.driver.version` is the report's lexicon version as a string, so
a host can tell which format emitted a result. `rules` is deduplicated by `${engine}/${ruleId}`,
first-seen order.

**With a baseline**, each result gains `properties.baseline` (`"novel"` or `"known"`), and a
`known` result gains a SARIF suppression:

```json
{
  "properties": { "baseline": "known" },
  "suppressions": [
    { "kind": "external", "status": "accepted", "justification": "accepted in the baseline" }
  ]
}
```

`properties.fixable` is a _signal_, not a SARIF `fixes` array: a real `fixes` entry requires
concrete `artifactChanges`, and until a rule can emit a patch, inventing one would be a lie.
When a rule can, the fix lands in `fixes` and `properties.fixable` becomes redundant.

## LSP 3.17 diagnostics

```
diagnostics[] -> LspDiagnostic[]
  ${engine}/${ruleId}   .code
  engine                .source
  message               .message
  severity              .severity   1=error, 2=warn, 3=info  (LSP's 4=Hint is never invented)
  line, column          .range.start  line-1, column-1       (LSP is 0-based; the report is 1-based)
  endLine, endColumn    .range.end    endLine-1, endColumn-1, or the start when absent
  docsUrl (optional)    .codeDescription.href
```

The 1-based → 0-based shift is the trap. A projection that ships without it puts every
squiggle one line and one column off.

## Code Climate issue JSON

```
diagnostics[] -> Issue[]
  ${engine}/${ruleId}   .check_name
  message               .description
  location.file         .location.path
  line, endLine         .location.lines.begin, .lines.end (optional)
  severity              .severity  error=major, warn=minor, info=info
  identity              .fingerprint
                        fallback ${engine}/${ruleId}:${file} when the finding declared none
```

The fingerprint is the one part that matters: Code Climate deduplicates on it, so it is
derived from the finding's **identity**, never from its line. A fingerprint that moves with
the code is a duplicate, and a duplicate is a false finding.

`categories` has no source in the report and is emitted as `["Style"]`. A repo with a real
taxonomy should map it from the rule id — and that mapping lives in the host, not here.

## What is genuinely open

- **A SARIF `fixes` array** from a real patch. `properties.fixable` says "this can be
  fixed"; `fixes` says how. The rule has to be able to emit an edit and prove it, and no
  rule can yet.
- **Baseline annotations for LSP and Code Climate.** Both could carry the same
  novel/known distinction (an LSP `DiagnosticTag.Unnecessary`, a Code Climate
  `categories`/`severity` downgrade). Specified for SARIF first, because that is the
  target whose readers actually honor suppressions.
- **`tool.driver.rules[].help.text` is currently the finding's sentence.** A rule should
  ship its own help text once; the report carries a per-finding one. When rule metadata
  becomes a record, this projection reads it and stops guessing.
