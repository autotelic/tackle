import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { workstreamDir } from "./store.ts"

/** The live journal for one workstream, outside the governed repo. */
export const journalFile = (input: {
  readonly id: string
  readonly home?: string | undefined
}): string => join(workstreamDir(input.home), input.id + ".journal.sqlite")

/**
 * Snapshot the journal with SQLite's online backup rather than copying a live file.
 *
 * @param input - the workstream, pass and status.
 * @returns the snapshot path.
 */
export const snapshotJournal = async (input: {
  readonly id: string
  readonly pass: number
  readonly at: string
  readonly status: "done" | "failed"
  readonly home?: string | undefined
}): Promise<string> => {
  await mkdir(workstreamDir(input.home), { recursive: true })
  const db = new DatabaseSync(journalFile(input))
  db.exec(
    "create table if not exists passes (pass integer primary key, at text not null, status text not null)",
  )
  db.prepare("insert or replace into passes (pass, at, status) values (?, ?, ?)").run(
    input.pass,
    input.at,
    input.status,
  )
  const target = join(workstreamDir(input.home), input.id + ".journal." + input.pass + ".sqlite")
  db.exec("VACUUM INTO '" + target.replaceAll("'", "''") + "'")
  db.close()
  return target
}
