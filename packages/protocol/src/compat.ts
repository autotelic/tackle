/*
 * The compat analyzer: the pure half of the lexicon-compat linter.
 *
 * The rule, restated where code enforces it: once a lexicon is in the wild, a schema change
 * must keep every previously-valid record valid. In schema terms, the language the new
 * schema accepts must be a SUPERSET of the old. Adding an optional field does that; adding
 * a required one, removing a field, narrowing a type or an enum, or flipping
 * `additionalProperties` to `false` does not.
 *
 * This module is a best-effort structural pre-check over the keyword subset our schemas
 * use. It is NOT the guarantee: the guarantee is the corpus in `fixtures/compat/`, which
 * the linter validates against the current schemas — a concrete record is the only thing
 * that cannot be argued with. Run `scripts/lexicon-compat.mjs` for that.
 *
 * No dependencies. The validator lives in the script and the tests, not here.
 */

import { isRecord } from "./decode.ts"

const propertyOf = (schema: Record<string, unknown>, key: string): unknown => schema[key]

const propertiesOf = (schema: Record<string, unknown>): Record<string, unknown> => {
  const properties = propertyOf(schema, "properties")
  return isRecord(properties) ? properties : {}
}

const requiredOf = (schema: Record<string, unknown>): ReadonlySet<string> => {
  const required = propertyOf(schema, "required")
  if (!Array.isArray(required)) return new Set()
  return new Set(required.filter((entry): entry is string => typeof entry === "string"))
}

const enumOf = (schema: Record<string, unknown>): ReadonlyArray<unknown> | undefined => {
  const values = propertyOf(schema, "enum")
  return Array.isArray(values) ? values : undefined
}

const typeOf = (schema: Record<string, unknown>): string | undefined =>
  typeof schema.type === "string" ? schema.type : undefined

/** `number` accepts every integer, so `integer → number` widens and the reverse narrows. */
const widensType = ({
  previous,
  next,
}: {
  readonly previous: string | undefined
  readonly next: string | undefined
}): boolean => {
  if (previous === undefined || next === undefined) return true
  if (previous === next) return true
  return previous === "integer" && next === "number"
}

const numberAt = (schema: Record<string, unknown>, key: string): number | undefined =>
  typeof schema[key] === "number" ? (schema[key] as number) : undefined

/**
 * The changes that would invalidate a record the previous schema accepted, as sentences.
 *
 * An empty list means the new schema is a superset over the structural subset checked here.
 * `path` is the dotted location of the lexicon in the JSON document, for a readable finding.
 */
export const schemaBreakingChanges = ({
  previous,
  next,
  path = "$",
}: {
  readonly previous: unknown
  readonly next: unknown
  readonly path?: string
}): ReadonlyArray<string> => {
  if (!isRecord(previous) || !isRecord(next)) return []
  const findings: Array<string> = []

  const previousProperties = propertiesOf(previous)
  const nextProperties = propertiesOf(next)
  const previousAdditional = propertyOf(previous, "additionalProperties")
  const nextAdditional = propertyOf(next, "additionalProperties")

  for (const [name, previousProperty] of Object.entries(previousProperties)) {
    const nextProperty = nextProperties[name]
    if (nextProperty === undefined) {
      // Removing a named property only breaks a record that still carries it. While
      // `additionalProperties` is not `false`, extras ride along and the value survives.
      if (nextAdditional === false) findings.push(`${path}.${name}: property removed`)
      continue
    }
    findings.push(
      ...schemaBreakingChanges({
        previous: previousProperty,
        next: nextProperty,
        path: `${path}.${name}`,
      }),
    )
  }

  for (const name of requiredOf(next)) {
    if (!requiredOf(previous).has(name)) {
      findings.push(`${path}.${name}: newly required (a record lacking it is now invalid)`)
    }
  }

  // JSON Schema's default is open, so anything except an explicit `false` accepts extras.
  if (previousAdditional !== false && nextAdditional === false) {
    findings.push(`${path}: additionalProperties was open, is now closed`)
  }

  if (!widensType({ previous: typeOf(previous), next: typeOf(next) })) {
    findings.push(`${path}: type narrowed (${typeOf(previous)} → ${typeOf(next)})`)
  }

  const previousEnum = enumOf(previous)
  const nextEnum = enumOf(next)
  if (previousEnum !== undefined && nextEnum !== undefined) {
    for (const value of previousEnum) {
      if (!nextEnum.includes(value)) findings.push(`${path}: enum value removed (${String(value)})`)
    }
  }

  const previousMinimum = numberAt(previous, "minimum")
  const nextMinimum = numberAt(next, "minimum")
  if (previousMinimum !== undefined && nextMinimum !== undefined && nextMinimum > previousMinimum) {
    findings.push(`${path}: minimum raised (${previousMinimum} → ${nextMinimum})`)
  }
  const previousMaximum = numberAt(previous, "maximum")
  const nextMaximum = numberAt(next, "maximum")
  if (previousMaximum !== undefined && nextMaximum !== undefined && nextMaximum < previousMaximum) {
    findings.push(`${path}: maximum lowered (${previousMaximum} → ${nextMaximum})`)
  }

  return findings
}
