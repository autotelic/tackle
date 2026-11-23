import { readFileSync } from "node:fs"
import { Result, Schema, SchemaParser } from "effect"
import { describe, expect, it } from "vitest"
import { VERSION } from "./version.ts"

/*
 * The label a consumer compares against npm.
 *
 * It was a constant, and the constant stopped moving while the package kept releasing. The
 * claim worth pinning is not the string — it is that the string is the manifest's.
 */
describe("VERSION", () => {
  it("is the version in the package manifest", () => {
    const Packaged = Schema.Struct({ version: Schema.String })
    const manifest = Result.getOrThrow(
      SchemaParser.decodeResult(Schema.fromJsonString(Packaged))(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ),
    )
    expect(VERSION).toBe(manifest.version)
    expect(VERSION).not.toBe("0.0.0")
  })
})
