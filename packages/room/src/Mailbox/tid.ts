import { Predicate } from "effect"

// AT TIDs: 13 chars of base32-sortable, a 53-bit microsecond timestamp in the high bits and a
// 10-bit clock id in the low bits. Sorted lexicographically, they sort by time.
const ALPHABET = "234567abcdefghijklmnopqrstuvwxyz"
const TID = /^[234567abcdefghijklmnopqrstuvwxyz]{13}$/

/** Whether a string is a well-formed AT TID. */
export const isTid: Predicate.Predicate<string> = (value) => TID.test(value)

/** Build a TID from a millisecond instant and a clock id; the call is named so numbers cannot swap. */
export const tidAt = (input: {
  readonly timestampMs: number
  readonly clockId: number
}): string => {
  let n = ((BigInt(Math.trunc(input.timestampMs)) * 1000n) << 10n) | BigInt(input.clockId & 0x3ff)
  let out = ""
  for (let i = 0; i < 13; i += 1) {
    out = ALPHABET[Number(n & 31n)]! + out
    n >>= 5n
  }
  return out
}
