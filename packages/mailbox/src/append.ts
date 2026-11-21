import { Option } from "effect"
import { basename } from "node:path"
import { isTurnPath, LogError, senderInBody, type Turn, type TurnLog } from "./log.ts"
import { tidAt } from "./tid.ts"

export interface AppendInput {
  readonly path: string
  readonly body: string
  readonly sender?: string
  readonly replyTo?: string | null
  /** The instant the turn is written. Passed at the boundary; the core never reads a clock. */
  readonly at: number
}

/**
 * The pre-wire `send`: assign the next dense seq and a TID, check the reply edge, and hand back
 * the new log. The file is rendered from the same body, so authoring and the gate cannot disagree.
 */
export const appendTurn = (log: TurnLog, input: AppendInput) => {
  const path = basename(input.path)
  if (!isTurnPath(path)) throw new LogError(`${path}: not a turn filename`)
  if (log.turns.some((turn) => turn.path === path)) {
    throw new LogError(`${path}: already in the log; a turn is written once`)
  }
  const sender = input.sender ?? Option.getOrUndefined(senderInBody(input.body))
  if (sender === undefined)
    throw new LogError("no sender: pass --sender or write a '— SENDER —' heading")
  const previous = log.turns.at(-1)
  const seq = (previous?.seq ?? 0) + 1
  // Two authors pick the same NNNN when they write concurrently; the log knows the real seq.
  if (Number(path.slice(0, 4)) !== seq) {
    throw new LogError(`${path}: filename says ${path.slice(0, 4)} but this turn is seq ${seq}`)
  }
  const replyTo = input.replyTo === undefined ? (previous?.tid ?? null) : input.replyTo
  if (replyTo !== null && !log.turns.some((turn) => turn.tid === replyTo)) {
    throw new LogError(`replyTo names no earlier turn: ${replyTo}`)
  }
  // A TID must sort after its predecessor; if the clock has not moved, step the microsecond.
  let at = input.at
  let tid = tidAt({ timestampMs: at, clockId: seq & 0x3ff })
  while (previous !== undefined && tid <= previous.tid) {
    at += 1
    tid = tidAt({ timestampMs: at, clockId: seq & 0x3ff })
  }
  const turn: Turn = { seq, tid, sender, replyTo, path, body: input.body }
  const next =
    log.backfill === undefined
      ? { turns: [...log.turns, turn] }
      : { backfill: log.backfill, turns: [...log.turns, turn] }
  return { log: next, turn }
}
