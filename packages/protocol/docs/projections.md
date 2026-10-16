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
   schema, and it should never constrain the report's design.

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

## SARIF 2.1.0

```
report                                  sarif.runs[0]
  .diagnostics[]                          .results[]
    ${engine}/${ruleId}                     .ruleId, and one .tool.driver.rules[] entry
    severity error|warn|info               .level  error|warning|note
    message                                 .message.text
    help (optional)                         .tool.driver.rules[].help.text
    docsUrl (optional)                      .tool.driver.rules[].helpUri
    location.file                           .locations[0].physicalLocation.artifactLocation.uri
    location.line/column/endLine/endColumn  .locations[0].physicalLocation.region.startLine/
                                            startColumn/endLine/endColumn
```

`version` is `"2.1.0"` and `$schema` is the published SARIF 2.1.0 schema URL. `tool.driver.name`
is the host's name. `rules` is deduplicated by `${engine}/${ruleId}`, first-seen order.

## LSP 3.17 diagnostics

```
diagnostics[] -> LspDiagnostic[]
  ${engine}/${ruleId}   .code
  engine                .source
  message               .message
  severity              .severity   1=error, 2=warn, 3=info  (LSP's 4=Hint is never invented)
  line, column          .range.start  line-1, column-1       (LSP is 0-based; the report is 1-based)
  endLine, endColumn    .range.end    endLine-1, endColumn-1, or the start when absent
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

## What a top format designer would do that we are not (yet)

- **Version the report's own shape in SARIF's `tool.driver.version`**, so a host can tell
  which protocol version emitted a result.
- **Carry the baseline decision** (`novel` vs `known`) as a SARIF `suppression` or a
  property bag, so a code-scanning tab can gray out what is accepted rather than hiding it.
- **Emit SARIF `fixes`** when a diagnostic is `fixable`, and LSP `codeDescription.href`
  from `docsUrl`. Both are free once the fields exist.
- **Publish the Code Climate mapping as a spec, not a format** we depend on; there is no
  schema to conform to, so it should be generated and forgotten.
