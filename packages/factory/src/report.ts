import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
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

/**
 * Deliver a report to a Tackle session over the intercom CLI.
 *
 * @param input - the report and the target session id.
 * @returns true when the CLI accepted it.
 */
export const deliverReport = (input: {
  readonly report: Report
  readonly to: string
}): Result.Result<void, string> => {
  const cli =
    process.env.INTERCOM_CLI ??
    join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-intercom", "cli.mjs")
  const text =
    "factory report " +
    input.report.id +
    " · " +
    input.report.kind +
    " · " +
    input.report.workstream +
    ": " +
    input.report.actual
  const result = spawnSync(process.execPath, [cli, "send", "--to", input.to, "--text", text], {
    encoding: "utf8",
  })
  return result.status === 0
    ? Result.succeed(undefined)
    : Result.fail((result.stderr || "intercom exited " + result.status).trim())
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

/**
 * Every decodable report, in id order; malformed reports are a miss.
 *
 * @param input - the optional home.
 * @returns the reports.
 */
export const listReports = async (input?: { readonly home?: string | undefined }) => {
  const names = await readdir(reportDir(input?.home)).catch(() => [])
  const reports: Array<Report> = []
  for (const name of names.sort((left, right) => left.localeCompare(right))) {
    if (!name.endsWith(".json")) continue
    const report = await readReport({ id: name.slice(0, -5), home: input?.home })
    if (report !== undefined) reports.push(report)
  }
  return reports
}

/** Read one report; malformed is a miss, because reports degrade to silence. */
export const readReport = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<Report | undefined> => {
  const text = await readFile(reportFile(input), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const decoded = Schema.decodeResult(Schema.fromJsonString(Report))(text)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}
