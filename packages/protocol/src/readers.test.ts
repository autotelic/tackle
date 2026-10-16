import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { fixturePath } from "./fixture-support.ts"

/*
 * The format is real only if a reader that is not the TypeScript can read the bytes.
 * `scripts/read-report.mjs` imports nothing from this package; this test runs it as a
 * process so the proof cannot quietly become a unit test of our own decoders.
 */
describe("the independent reader", () => {
  it("reads a report with nothing but Node and the bytes", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/read-report.mjs", "fixtures/report/golden.json"],
      { cwd: fixturePath("."), encoding: "utf8" },
    )
    expect(output.trim()).toBe("1 finding(s) in 1 file(s): 0 error(s), 0 warning(s)")
  })

  it("refuses a document that is not a report", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/read-report.mjs", "fixtures/catalog/golden.json"], {
        cwd: fixturePath("."),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow()
  })
})
