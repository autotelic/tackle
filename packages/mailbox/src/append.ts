import { basename } from "node:path"
import { isTurnPath, LogError, type Turn, type TurnLog } from "./log.ts"
import { tidAt } from "./tid.ts"

const SENDER = /^#\s+\d{4}\s+—\s+(\S+)\s+—/

export interface AppendInput {
  readonly path: string
  readonly body: string
  readonly sender?: string
  readonly replyTo?: string | null
  /** Injectable for tests; production passes the wall clock. */
  readonly at?: number
}

/**
 * The pre-wire `send`: assign the next dense seq and a TID, check the reply edge, and hand back
 * the new log. The file is rendered from the same body, so authoring and the gate cannot disagree.
 */
export const appendTurn = (
  log: TurnLog,
  input: AppendInput,
): { readonly log: TurnLog; readonly turn: Turn } => {
  const path = basename(input.path)
  if (!isTurnPath(path)) throw new LogError(`${path}: not a turn filename`)
  const sender = input.sender ?? SENDER.exec(input.body)?.[1]
  if (sender === undefined)
    throw new LogError("no sender: pass --sender or write a '— SENDER —' heading")
  const previous = log.turns.at(-1)
  const seq = (previous?.seq ?? 0) + 1
  const replyTo = input.replyTo === undefined ? (previous?.tid ?? null) : input.replyTo
  if (replyTo !== null && !log.turns.some((turn) => turn.tid === replyTo)) {
    throw new LogError(`replyTo names no earlier turn: ${replyTo}`)
  }
  // A TID must sort after its predecessor; if the clock has not moved, step the microsecond.
  let at = input.at ?? Date.now()
  let tid = tidAt(at, seq & 0x3ff)
  while (previous !== undefined && tid <= previous.tid) {
    at += 1
    tid = tidAt(at, seq & 0x3ff)
  }
  const turn: Turn = { seq, tid, sender, replyTo, path, body: input.body }
  return {
    log: {
      ...(log.backfill === undefined ? {} : { backfill: log.backfill }),
      turns: [...log.turns, turn],
    },
    turn,
  }
}
