import { encode } from "@ipld/dag-cbor"
import { createHash } from "node:crypto"
import type { TurnLog } from "./log.ts"

/**
 * The journal's identity is its record set, not the bytes of the file it was rendered from.
 * DAG-CBOR gives the set one encoding (DRISL: map keys length-then-bytewise), so a key-order
 * rewrite or a markdown re-render cannot make a continuation token read as divergent.
 */
export const journalDigest = (log: TurnLog): string => {
  const records = log.turns.map((turn) => ({ ...turn }))
  const payload =
    log.backfill === undefined ? { records } : { backfill: { ...log.backfill }, records }
  return createHash("sha256").update(encode(payload)).digest("hex")
}
