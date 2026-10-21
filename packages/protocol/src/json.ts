/*
 * Text to value, without a throw.
 *
 * Both cutlist's staleness gate and jig's baseline read committed JSON. A malformed file
 * must degrade to a miss, not kill the run. The try/catch used to be spelled twice, which
 * is the kind of copy a format can own: the seam that says what a record looks like can
 * also say how its bytes become one.
 */

/** Parse JSON, answering `undefined` for malformed text instead of throwing. */
export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
