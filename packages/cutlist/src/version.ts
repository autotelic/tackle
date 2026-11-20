import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Result, Schema, SchemaParser } from "effect"

/*
 * The version this build actually is.
 *
 * The CLI printed a hardcoded "0.0.0" (plus a checkout's git sha as build metadata), so a
 * consumer comparing an install against npm read a number that never moved: an npm-installed
 * cutlist still reported v0.0.0+<cwd sha>. The manifest is the one place a release writes, so
 * the tool reads it; the sha, when there is one, rides along as build metadata and answers
 * "is my link current?" for a checkout.
 *
 * Two path shapes resolve to the same file: `dist/version.js` and `src/version.ts` both
 * sit one directory below the package root. A build that cannot read its own manifest says
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
