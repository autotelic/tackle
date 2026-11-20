// AT TIDs: 13 chars of base32-sortable, a 53-bit microsecond timestamp in the high bits and
// a 10-bit clock id in the low bits. Sorted lexicographically, they sort by time, which is the
// property the log relies on: TID order is the fold order.
const ALPHABET = "234567abcdefghijklmnopqrstuvwxyz"
const TID = /^[234567abcdefghijklmnopqrstuvwxyz]{13}$/

export const isTid = (value: string): boolean => TID.test(value)

export const tidAt = (timestampMs: number, clockId: number): string => {
  let n = ((BigInt(Math.trunc(timestampMs)) * 1000n) << 10n) | BigInt(clockId & 0x3ff)
  let out = ""
  for (let i = 0; i < 13; i += 1) {
    out = ALPHABET[Number(n & 31n)] + out
    n >>= 5n
  }
  return out
}
