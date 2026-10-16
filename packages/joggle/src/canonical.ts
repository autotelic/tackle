import { isRecord } from "./workspace.ts"

/**
 * Stable JSON, for a content-addressed cache key.
 *
 * The key must not depend on property insertion order, or a replay in CI would
 * miss the judgement recorded locally. It is deliberately untyped: its whole job
 * is to accept whatever JSON a request carries and produce the same string for
 * the same value, and a domain type here would lie about what it does.
 */
export const canonical = (value: unknown): string => {
  const encode = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map((item) => encode(item))
    if (isRecord(input)) {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(input).sort((left, right) => left.localeCompare(right))) {
        out[key] = encode(input[key])
      }
      return out
    }
    return input
  }
  return JSON.stringify(encode(value))
}
