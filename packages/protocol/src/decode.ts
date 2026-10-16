/*
 * Untrusted-input primitives.
 *
 * Every decoder in this package is a pure function from `unknown` to either a typed value
 * or `undefined` — never a throw. An app calls one on whatever `JSON.parse` produced; a
 * malformed record degrades to silence (a miss, an empty view), never to a crash and never
 * to a false finding. The schema under `schema/` is what a WRITER must emit; these readers
 * are deliberately more tolerant, so a record from a newer tool that added a field still
 * parses here.
 *
 * Nothing here does I/O. The caller owns `JSON.parse`; this owns "is it a record".
 */

import { isLexiconName, type LexiconName, type LexiconRef } from "./lexicon.ts"

/** A JSON object, as opposed to an array, `null`, or a scalar. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A string, including the empty one. */
export const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

/** A finite number. */
export const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

/** An integer. */
export const int = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined

/** A boolean. */
export const bool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined

/** One of a closed set of strings. */
export const oneOf = <T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
): T | undefined =>
  typeof value === "string" && (allowed as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : undefined

/**
 * An array where every element decodes. A single bad element fails the whole array: a list
 * with one unreadable entry is a record this reader cannot trust, and a partially-read list
 * is a false finding waiting to happen.
 */
export const arrayOf = <T>(
  value: unknown,
  read: (element: unknown) => T | undefined,
): ReadonlyArray<T> | undefined => {
  if (!Array.isArray(value)) return undefined
  const out: Array<T> = []
  for (const element of value) {
    const decoded = read(element)
    if (decoded === undefined) return undefined
    out.push(decoded)
  }
  return out
}

/** An array of strings. */
export const strings = (value: unknown): ReadonlyArray<string> | undefined => arrayOf(value, str)

/**
 * The record's lexicon reference, checked against the name the caller expected.
 *
 * Prefers the explicit `lexicon` object. Falls back to the single `protocolVersion` string
 * the format carried before per-lexicon versioning: that string named no lexicon, so the
 * caller's `expected` is the only name it can mean, and it maps to version 1. This is the
 * one migration the evolution rule is allowed to carry forward forever, which is why it
 * lives in a reader and not in a decoder that could drift.
 */
export const readLexiconRef = (
  record: Record<string, unknown>,
  expected: LexiconName,
): LexiconRef | undefined => {
  if ("lexicon" in record) {
    const ref = record.lexicon
    if (typeof ref !== "object" || ref === null || Array.isArray(ref)) return undefined
    const shape = ref as Record<string, unknown>
    if (!isLexiconName(shape.name) || shape.name !== expected) return undefined
    const version = int(shape.version)
    return version === undefined || version < 1 ? undefined : { name: expected, version }
  }
  if (typeof record.protocolVersion === "string") return { name: expected, version: 1 }
  return undefined
}
