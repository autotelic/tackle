import { toNumber } from "./helper.ts"

/**
 * Two functions whose callee names are identical and whose inputs are not.
 *
 * The first version of this rule keyed a body by callee names alone, so these
 * two read as the same `Number -> Number -> String` and one was reported as a
 * re-implementation of the other. They read different fields, which is exactly
 * the difference the key was throwing away.
 */
export function companyOwnership(record: Record<string, unknown>): string {
  return String(toNumber(record.companyTotal))
}

export function crewOwnership(record: Record<string, unknown>): string {
  return String(toNumber(record.crewTotal))
}
