#!/usr/bin/env node
/*
 * The second, independent reader.
 *
 * Deliberately not a TypeScript file and deliberately not importing `@autotelic/protocol`:
 * it reads a report's bytes with nothing but Node's standard library. If this can read a
 * report, the format is a file format and not merely the package that defines it. If it
 * ever needs the package to parse a report, the format has quietly become an API.
 *
 * Usage: node scripts/read-report.mjs <report.json>
 */

import { readFileSync } from "node:fs"

const path = process.argv[2]
if (path === undefined) {
  console.error("usage: read-report.mjs <report.json>")
  process.exit(2)
}

try {
  const report = JSON.parse(readFileSync(path, "utf8"))
  const name = report?.lexicon?.name
  if (name !== "report" || !Array.isArray(report.diagnostics)) {
    console.error("read-report: not a report record")
    process.exit(1)
  }
  const errors = report.diagnostics.filter((finding) => finding.severity === "error").length
  const warnings = report.diagnostics.filter((finding) => finding.severity === "warn").length
  console.log(
    `${report.diagnostics.length} finding(s) in ${report.files} file(s): ${errors} error(s), ${warnings} warning(s)`,
  )
} catch (error) {
  console.error(`read-report: unreadable (${error.message})`)
  process.exit(1)
}
