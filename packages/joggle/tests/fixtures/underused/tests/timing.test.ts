/**
 * The suite's own clock arithmetic, beside the code it tests.
 *
 * Test files are excluded from the evidence: a fixture's deadline is the harness
 * arranging itself, not the product re-implementing a duration.
 */
export const afterTimeout = (startedAt: number): boolean => Date.now() - startedAt > 60_000

export const retryWindow = (): number => 30_000
