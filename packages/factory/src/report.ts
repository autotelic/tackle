import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { factoryHome } from "./store.ts"

/** A tooling complaint from a foreman; it is not a desk item. */
export const ReportKind = Schema.Literals([
  "ergonomics",
  "conformance",
  "docs",
  "blocker",
  "quality",
])

export const Report = Schema.Struct({
  id: Schema.String,
  workstream: Schema.String,
  kind: ReportKind,
  at: Schema.String,
  command: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
  output: Schema.String,
  evidence: Schema.optional(
    Schema.Struct({
      receipt: Schema.optional(Schema.String),
      refs: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  blocked: Schema.Boolean,
  fingerprint: Schema.String,
})
export type Report = typeof Report.Type

/**
 * The directory holding factory reports.
 *
 * @param home - the factory home.
 * @returns the reports directory.
 */
export const reportDir = (home: string = factoryHome()): string => join(home, "reports")

/**
 * The file for one factory report.
 *
 * @param input - the report id and optional home.
 * @returns the report path.
 */
export const reportFile = (input: {
  readonly id: string
  readonly home?: string | undefined
}): string => join(reportDir(input.home), input.id + ".json")

/** A fingerprint is stable per kind, command and the first failing line. */
export const fingerprintOf = (input: {
  readonly kind: Report["kind"]
  readonly command: string
  readonly actual: string
}): string => {
  const line = input.actual.split("\n").find((value) => value.trim() !== "") ?? ""
  const digest = createHash("sha256")
    .update(input.kind + "\u0000" + input.command + "\u0000" + line)
    .digest("hex")
    .slice(0, 12)
  return input.kind + ":" + input.command + ":" + digest
}

/** Write one report outside every governed repo. */
export const writeReport = async (input: {
  readonly report: Report
  readonly home?: string
}): Promise<void> => {
  await mkdir(reportDir(input.home), { recursive: true })
  await writeFile(
    reportFile({ id: input.report.id, home: input.home }),
    JSON.stringify(input.report, null, 2) + "\n",
  )
}

/** Read one report; malformed is a miss, because reports degrade to silence. */
export const readReport = async (input: {
  readonly id: string
  readonly home?: string
}): Promise<Report | undefined> => {
  const text = await readFile(reportFile(input), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const decoded = Schema.decodeResult(Schema.fromJsonString(Report))(text)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}
