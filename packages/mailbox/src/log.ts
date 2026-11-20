import { isTid } from "./tid.ts"

/**
 * A turn is the wire record: the body the sender wrote, addressed by its own TID and linked to
 * the turn it answers. `path` is frozen too, because the markdown projection needs a stable
 * filename and deriving one from the heading would make the renderer depend on prose.
 */
export interface Turn {
  readonly seq: number
  readonly tid: string
  readonly sender: string
  readonly replyTo: string | null
  readonly path: string
  readonly body: string
}

/**
 * A backfill header is how history that predates the wire enters the log honestly. Senders are
 * labels because no participant held a key yet; timestamps are file mtimes, not send times.
 */
export interface Backfill {
  readonly kind: "backfill"
  readonly at: string
  readonly from: readonly string[]
  readonly timestampSource: "mtime" | "declared"
  readonly note?: string
}

export interface TurnLog {
  readonly backfill?: Backfill
  readonly turns: readonly Turn[]
}

export class LogError extends Error {}

export const isTurnPath = (path: string): boolean =>
  /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)

const record = (value: unknown, where: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LogError(`${where}: not an object`)
  }
  return value as Record<string, unknown>
}

const text = (value: unknown, where: string): string => {
  if (typeof value !== "string" || value === "")
    throw new LogError(`${where}: expected a non-empty string`)
  return value
}

const decodeBackfill = (value: Record<string, unknown>, where: string): Backfill => {
  const from = value.from
  if (!Array.isArray(from) || from.some((entry) => typeof entry !== "string")) {
    throw new LogError(`${where}: backfill.from must be string[]`)
  }
  const source = value.timestampSource
  if (source !== "mtime" && source !== "declared") {
    throw new LogError(`${where}: backfill.timestampSource must be "mtime" or "declared"`)
  }
  return {
    kind: "backfill",
    at: text(value.at, `${where}.at`),
    from,
    timestampSource: source,
    ...(typeof value.note === "string" ? { note: value.note } : {}),
  }
}

const decodeTurn = (value: Record<string, unknown>, where: string): Turn => {
  const seq = value.seq
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
    throw new LogError(`${where}: seq must be a positive integer`)
  }
  const tid = text(value.tid, `${where}.tid`)
  if (!isTid(tid)) throw new LogError(`${where}: tid is not a TID`)
  const replyTo = value.replyTo
  if (replyTo !== null && (typeof replyTo !== "string" || !isTid(replyTo))) {
    throw new LogError(`${where}: replyTo must be a TID or null`)
  }
  const path = text(value.path, `${where}.path`)
  if (!isTurnPath(path)) throw new LogError(`${where}: path is not a turn file`)
  return {
    seq,
    tid,
    sender: text(value.sender, `${where}.sender`),
    replyTo,
    path,
    body: text(value.body, `${where}.body`),
  }
}

/**
 * Read defensively means "name the broken line", not "skip it". A turn dropped in silence is a
 * turn the projection will happily render as if it never existed.
 */
export const parseLog = (text: string): TurnLog => {
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  let backfill: Backfill | undefined
  const turns: Turn[] = []
  const tids = new Set<string>()
  for (const [index, line] of lines.entries()) {
    const where = `line ${index + 1}`
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new LogError(`${where}: not JSON`)
    }
    const value = record(parsed, where)
    if (value.kind === "backfill") {
      if (backfill !== undefined || turns.length > 0)
        throw new LogError(`${where}: backfill must be the first line`)
      backfill = decodeBackfill(value, where)
      continue
    }
    const turn = decodeTurn(value, where)
    const previous = turns.at(-1)
    if (previous !== undefined && turn.seq <= previous.seq)
      throw new LogError(`${where}: seq is not increasing`)
    if (tids.has(turn.tid)) throw new LogError(`${where}: duplicate tid`)
    if (turn.replyTo !== null && !tids.has(turn.replyTo))
      throw new LogError(`${where}: replyTo names no earlier turn`)
    tids.add(turn.tid)
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
