import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { deliverReport, fingerprintOf, readReport, writeReport } from "../src/report.ts"

/* oxlint-disable plumb/prefer-property-tests -- one stable report record. */

test("a report round-trips and its fingerprint ignores the later lines", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-report-"))
  try {
    const first = fingerprintOf({
      kind: "conformance",
      command: "jig check",
      actual: "packages/factory/src/adopt.ts:41 plumb/require-jsdoc\nmore",
    })
    const second = fingerprintOf({
      kind: "conformance",
      command: "jig check",
      actual: "packages/factory/src/adopt.ts:41 plumb/require-jsdoc\ndifferent",
    })
    expect(first).toBe(second)
    const report = {
      id: "report-perms-1862-1",
      workstream: "perms-1862",
      kind: "conformance" as const,
      at: "2026-11-21T23:22:00.000Z",
      command: "jig check",
      expected: "0 error",
      actual: "1 warn",
      output: "",
      blocked: false,
      fingerprint: first,
    }
    await writeReport({ report, home: root })
    expect(await readReport({ id: report.id, home: root })).toEqual(report)

    const cli = join(root, "intercom.mjs")
    writeFileSync(
      cli,
      '#!/usr/bin/env node\nimport { writeFileSync } from "node:fs"\nwriteFileSync(process.env.INTERCOM_LOG, process.argv.slice(2).join(" "))\n',
    )
    chmodSync(cli, 0o755)
    const log = join(root, "intercom.log")
    process.env.INTERCOM_CLI = cli
    process.env.INTERCOM_LOG = log
    expect(deliverReport({ report, to: "01a1f0c4" })._tag).toBe("Success")
    expect(readFileSync(log, "utf8")).toContain("--to 01a1f0c4")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
