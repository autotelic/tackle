import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { isTurnPath, LogError, type Turn, type TurnLog } from "./log.ts"
import { tidAt } from "./tid.ts"

const SENDER = /^#\s+\d{4}\s+—\s+(\S+)\s+—/

export const BACKFILL_NOTE =
  "Senders are role labels, not DIDs: no key existed before the wire. Timestamps are file mtimes, not send times."

/**
 * Bootstrap: turn a directory of `NNNN-*.md` turns into a log. This runs once, before the host
 * exists, so the projection can be proven against history we already trust. Live turns are never
 * exported this way; they arrive through `send`.
 */
export const exportDirectory = async (
  dir: string,
  options: { at?: string; note?: string } = {},
): Promise<TurnLog> => {
  const names = (await readdir(dir)).filter(isTurnPath).sort()
  if (names.length === 0) throw new LogError(`${dir}: no turn files`)
  const turns: Turn[] = []
  let previous: string | null = null
  for (const name of names) {
    const path = join(dir, name)
    const [body, stats] = await Promise.all([readFile(path, "utf8"), stat(path)])
    const seq = Number(name.slice(0, 4))
    const sender = SENDER.exec(body)?.[1]
    if (sender === undefined) throw new LogError(`${name}: no "— SENDER —" heading`)
    const tid = tidAt(stats.mtimeMs, seq & 0x3ff)
    turns.push({ seq, tid, sender, replyTo: previous, path: name, body })
    previous = tid
  }
  return {
    backfill: {
      kind: "backfill",
      at: options.at ?? new Date().toISOString(),
      from: names,
      timestampSource: "mtime",
      note: options.note ?? BACKFILL_NOTE,
    },
    turns,
  }
}
