#!/usr/bin/env node
/*
 * The lexicon-compat linter.
 *
 * The rule it enforces, in CI: once a lexicon is in the wild you may ADD AN OPTIONAL
 * FIELD, and you may never invalidate a record that was previously valid. This script
 * holds a frozen corpus — `fixtures/compat/<lexicon>.vN.json`, one record per lexicon per
 * released version — and validates every one of them against the CURRENT schema. A change
 * that would reject an old record fails here, before it reaches a reader.
 *
 * It is independent of the TypeScript on purpose: it reads the JSON Schema and the bytes,
 * not the package. Run `pnpm --filter @autotelic/protocol lexicon:compat`.
 */

import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import Ajv2020 from "ajv/dist/2020.js"

const compatDir = fileURLToPath(new URL("../fixtures/compat", import.meta.url))
const schemaDir = fileURLToPath(new URL("../schema", import.meta.url))

const read = (path) => JSON.parse(readFileSync(path, "utf8"))
const ajv = new Ajv2020({ allErrors: true, strict: false })

const failures = []
let checked = 0
let skipped = 0

for (const file of readdirSync(compatDir).sort((a, b) => a.localeCompare(b))) {
  if (!file.endsWith(".json")) continue
  const lexicon = file.replace(/\.json$/u, "").replace(/\.v\d+$/u, "")
  const schemaPath = `${schemaDir}/${lexicon}.json`
  let schema
  try {
    schema = read(schemaPath)
  } catch {
    skipped += 1
    continue
  }
  const validate = ajv.compile(schema)
  const record = read(`${compatDir}/${file}`)
  checked += 1
  if (!validate(record)) {
    failures.push({
      file,
      lexicon,
      errors: (validate.errors ?? []).map(
        (error) => `${error.instancePath || "/"} ${error.message}`,
      ),
    })
  }
}

if (failures.length > 0) {
  console.error("lexicon-compat: a schema change would invalidate a previously-valid record\n")
  for (const failure of failures) {
    console.error(`  ${failure.file} (lexicon ${failure.lexicon}):`)
    for (const error of failure.errors) console.error(`    - ${error}`)
  }
  console.error(
    "\nIf the change is intended and breaking, it needs a NEW lexicon name, not a new schema.\n" +
      "If it is additive, the corpus should not have noticed — fix the schema, not the corpus.",
  )
  process.exit(1)
}

console.log(`lexicon-compat: ${checked} frozen record(s) valid against the current schemas`)
if (skipped > 0) console.log(`lexicon-compat: ${skipped} corpus file(s) had no schema; skipped`)
