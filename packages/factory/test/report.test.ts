import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { fingerprintOf, readReport, writeReport } from "../src/report.ts"

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
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
