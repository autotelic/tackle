import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Result, Schema, SchemaParser } from "effect"

/*
 * The version this build actually is.
 *
 * `policy.version` held a hand-typed "0.1.0" while the package reached 0.8.1, and
 * `joggle --version` printed it. A consumer comparing versions to prove a fix arrived read
 * a number that never moved; so did every cache document that stamped it. The manifest is
 * the one place a release writes, so the tool reads it instead of repeating it.
 *
 * Two path shapes resolve to the same file: `dist/version.js` and `src/version.ts` both sit
 * one directory below the package root. A build that cannot read its own manifest reports
 * 0.0.0 rather than failing, because the version is a label on a report, not an input to it.
 */

const Packaged = Schema.Struct({ version: Schema.String })

const readVersion = (): string => {
  const file = fileURLToPath(new URL("../package.json", import.meta.url))
  const text = Result.getOrElse(
    Result.try(() => readFileSync(file, "utf8")),
    () => "",
  )
  const decoded = Result.getOrUndefined(
    SchemaParser.decodeResult(Schema.fromJsonString(Packaged))(text),
  )
  return decoded?.version ?? "0.0.0"
}

export const VERSION = readVersion()
