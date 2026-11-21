import { Predicate, Result, Schema } from "effect"
import { isTid } from "./tid.ts"

/** A turn is the wire record: the body the sender wrote, addressed by its own TID and linked to the turn it answers. */
export interface Turn {
  readonly seq: number
  readonly tid: string
  readonly sender: string
  readonly replyTo: string | null
  readonly path: string
  readonly body: string
}

/** History from before the wire: senders are labels, not DIDs; timestamps are file mtimes. */
export interface Backfill {
  readonly kind: "backfill"
  readonly at: string
  readonly from: readonly string[]
  readonly timestampSource: "mtime" | "declared"
  readonly note?: string | undefined
}

export interface TurnLog {
  readonly backfill?: Backfill
  readonly turns: readonly Turn[]
}

export class LogError extends Error {}

const BackfillLine = Schema.Struct({
  kind: Schema.Literal("backfill"),
  at: Schema.String,
  from: Schema.Array(Schema.String),
  timestampSource: Schema.Union([Schema.Literal("mtime"), Schema.Literal("declared")]),
  note: Schema.optional(Schema.String),
})

const TurnLine = Schema.Struct({
  seq: Schema.Int,
  tid: Schema.String,
  sender: Schema.String,
  replyTo: Schema.NullOr(Schema.String),
  path: Schema.String,
  body: Schema.String,
})

const Line = Schema.Union([BackfillLine, TurnLine])
const decodeLine = Schema.decodeUnknownResult(Schema.fromJsonString(Line))

/** One turn file name: four digits, a slug, and `.md`. */
export const isTurnPath: Predicate.Predicate<string> = (path) =>
  /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)

/**
 * Read defensively means name the broken line, never skip it: a turn dropped in silence is a turn
 * the projection renders as if it never existed. The line is decoded through the schema, so a
 * malformed shape is a named error, not a cast.
 */
export const parseLog = (text: string): TurnLog => {
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  let backfill: Backfill | undefined
  const turns: Turn[] = []
  const tids = new Set<string>()
  const paths = new Set<string>()
  for (const [index, line] of lines.entries()) {
    const where = `line ${index + 1}`
    const decoded = decodeLine(line)
    if (Result.isFailure(decoded)) throw new LogError(`${where}: ${String(decoded.failure)}`)
    const value = decoded.success
    if ("kind" in value) {
      if (backfill !== undefined || turns.length > 0)
        throw new LogError(`${where}: backfill must be the first line`)
      backfill = value
      continue
    }
    const turn = value
    if (turn.seq < 1) throw new LogError(`${where}: seq must be positive`)
    if (!isTid(turn.tid)) throw new LogError(`${where}: tid is not a TID`)
    if (turn.replyTo !== null && !isTid(turn.replyTo))
      throw new LogError(`${where}: replyTo must be a TID or null`)
    if (!isTurnPath(turn.path)) throw new LogError(`${where}: path is not a turn file`)
    if (turn.body === "" || turn.sender === "") throw new LogError(`${where}: empty field`)
    const previous = turns.at(-1)
    if (previous === undefined && turn.seq !== 1)
      throw new LogError(`${where}: the log must start at seq 1`)
    if (previous !== undefined && turn.seq !== previous.seq + 1)
      throw new LogError(`${where}: seq must be dense (expected ${previous.seq + 1})`)
    if (tids.has(turn.tid)) throw new LogError(`${where}: duplicate tid`)
    if (paths.has(turn.path)) throw new LogError(`${where}: duplicate path (one turn per file)`)
    if (previous !== undefined && turn.tid <= previous.tid)
      throw new LogError(`${where}: tid is not increasing`)
    if (turn.replyTo !== null && !tids.has(turn.replyTo))
      throw new LogError(`${where}: replyTo names no earlier turn`)
    tids.add(turn.tid)
    paths.add(turn.path)
    turns.push(turn)
  }
  return backfill === undefined ? { turns } : { backfill, turns }
}

/** One exact shape: the header first, then one line per turn in seq order. */
export const serializeLog = (log: TurnLog): string => {
  const lines = log.turns.map((turn) =>
    JSON.stringify({
      seq: turn.seq,
      tid: turn.tid,
      sender: turn.sender,
      replyTo: turn.replyTo,
      path: turn.path,
      body: turn.body,
    }),
  )
  return (
    [...(log.backfill === undefined ? [] : [JSON.stringify(log.backfill)]), ...lines].join("\n") +
    "\n"
  )
}

const SENDER = /^#\s+\d{4}\s+—\s+(\S+)\s+—/

/** The sender a turn heading names, if it names one. */
export const senderOf = (body: string): string | undefined => SENDER.exec(body)?.[1]
