import { Option, Predicate, Result, Schema } from "effect"
import stringify from "safe-stable-stringify"
import { isTid } from "./tid.ts"

/** A turn is the wire record, plus any field a newer writer added; unknown fields are kept. */
export interface Turn {
  readonly seq: number
  readonly tid: string
  readonly sender: string
  readonly replyTo: string | null
  readonly path: string
  readonly body: string
  // Unknown fields are the point of an open record; the codec preserves them.
  // oxlint-disable-next-line plumb/no-unsafe-dictionary-type
  readonly [key: string]: unknown
}

/** History from before the wire, with the same open tail. */
export interface Backfill {
  readonly kind: "backfill"
  readonly at: string
  readonly from: readonly string[]
  readonly timestampSource: "mtime" | "declared"
  readonly note?: string | undefined
  // oxlint-disable-next-line plumb/no-unsafe-dictionary-type
  readonly [key: string]: unknown
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
const decodeObject = Schema.decodeUnknownResult(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)
const decodeLine = Schema.decodeUnknownResult(Line)

/** One turn file name: four digits, a slug, and `.md`. */
export const isTurnPath: Predicate.Predicate<string> = (path) =>
  /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)

/**
 * Read defensively means name the broken line, never skip it. Known fields are validated; the
 * raw object is the source, so a field this version does not know survives the parse.
 */
export const parseLog = (text: string): TurnLog => {
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  let backfill: Backfill | undefined
  const turns: Turn[] = []
  const tids = new Set<string>()
  const paths = new Set<string>()
  for (const [index, line] of lines.entries()) {
    const where = `line ${index + 1}`
    const object = decodeObject(line)
    if (Result.isFailure(object)) throw new LogError(`${where}: ${String(object.failure)}`)
    const raw = object.success
    const decoded = decodeLine(raw)
    if (Result.isFailure(decoded)) throw new LogError(`${where}: ${String(decoded.failure)}`)
    const value = decoded.success
    if (Schema.is(BackfillLine)(value)) {
      if (backfill !== undefined || turns.length > 0)
        throw new LogError(`${where}: backfill must be the first line`)
      backfill = { ...raw, ...value }
      continue
    }
    const turn: Turn = { ...raw, ...value }
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

/** One canonical line per turn, the header first; unknown fields included, keys sorted. */
export const serializeLog = (log: TurnLog): string => {
  const lines = log.turns.map((turn) => stringify(turn))
  return (
    [...(log.backfill === undefined ? [] : [stringify(log.backfill)]), ...lines].join("\n") + "\n"
  )
}

const SENDER = /^#\s+\d{4}\s+—\s+(\S+)\s+—/

/** The sender a turn heading names, if it names one. */
export const senderInBody = (body: string): Option.Option<string> => {
  const match = SENDER.exec(body)
  return match?.[1] === undefined ? Option.none() : Option.some(match[1])
}
