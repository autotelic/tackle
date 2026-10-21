/*
 * Test-only support: locating fixtures, and compiling their schemas with an outside judge.
 *
 * Excluded from the published build (tsconfig.build.json), so the package's runtime keeps
 * its zero dependencies; Ajv is a devDependency and only ever runs in a test or the compat
 * linter. This file is the difference between "the TypeScript agrees with itself" and "a
 * validator that is not the TypeScript agrees with the schema".
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import Ajv2020 from "ajv/dist/2020.js"
import type { AnySchema, ValidateFunction } from "ajv"
import { decodeBaseline } from "./baseline.ts"
import { decodeCatalog, decodeManifest } from "./catalog.ts"
import { decodeCutlistConfig, decodeHarnessConfig } from "./config.ts"
import { decodeMenu, decodeOnboarding } from "./doc.ts"
import { decodeIntent } from "./intent.ts"
import type { LexiconName } from "./lexicon.ts"
import { decodeReport } from "./report.ts"

/** A path inside the package, from the package root. */
export const fixturePath = (relative: string): string =>
  fileURLToPath(new URL(`../${relative}`, import.meta.url))

/** Read and parse a JSON fixture or schema. Throws only if the file itself is missing. */
export const loadJson = (relative: string): unknown =>
  JSON.parse(readFileSync(fixturePath(relative), "utf8")) as unknown

/** Whether a fixture exists. The frozen pre-versioning record is not present everywhere. */
export const fixtureExists = (relative: string): boolean => existsSync(fixturePath(relative))

/** A fresh Ajv for draft 2020-12. `strict: false` because we use `$defs` freely. */
export const makeAjv = (): Ajv2020 =>
  new Ajv2020({ allErrors: true, strict: false, addUsedSchema: false })

/** Compile a lexicon's schema. */
export const compileLexicon = (ajv: Ajv2020, name: LexiconName): ValidateFunction =>
  ajv.compile(loadJson(`schema/${name}.json`) as AnySchema)

/**
 * The one decoder per lexicon, keyed by name.
 *
 * Kept here rather than in `lexicon.ts` so the registry stays free of the modules that
 * import it — `report.ts` reads the registry, so the registry cannot read `report.ts`.
 */
export const DECODERS: Readonly<Record<LexiconName, (value: unknown) => unknown>> = {
  report: (value) => decodeReport(value),
  baseline: (value) => decodeBaseline(value),
  catalog: (value) => decodeCatalog(value),
  manifest: (value) => decodeManifest(value),
  menu: (value) => decodeMenu(value),
  intent: (value) => decodeIntent(value),
  onboarding: (value) => decodeOnboarding(value),
  "cutlist.config": (value) => decodeCutlistConfig(value),
  "jig.config": (value) => decodeHarnessConfig(value),
}
