import { isTurnPath, type Turn, type TurnLog } from "./log.ts"

/** The body is the record; the file is the body plus exactly one trailing newline. */
export const renderTurn = (turn: Turn): string =>
  turn.body.endsWith("\n") ? turn.body : `${turn.body}\n`

export const renderLog = (log: TurnLog): ReadonlyMap<string, string> =>
  new Map(log.turns.map((turn) => [turn.path, renderTurn(turn)]))

export type DriftKind = "missing" | "extra" | "differs"

export interface Drift {
  readonly path: string
  readonly kind: DriftKind
}

/**
 * The ratchet applied to our own thread: regenerate from the log and compare bytes. A file that
 * differs is an edit that skipped the mailbox; a file that exists only on disk is a turn that was
 * never sent; a missing file is a log entry the repository lost.
 */
export const verifyLog = (log: TurnLog, files: ReadonlyMap<string, string>): readonly Drift[] => {
  const expected = renderLog(log)
  const drift: Drift[] = []
  for (const [path, body] of expected) {
    const actual = files.get(path)
    if (actual === undefined) drift.push({ path, kind: "missing" })
    else if (actual !== body) drift.push({ path, kind: "differs" })
  }
  for (const path of files.keys()) {
    if (isTurnPath(path) && !expected.has(path)) drift.push({ path, kind: "extra" })
  }
  return drift
}
