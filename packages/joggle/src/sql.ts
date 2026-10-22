/** One call on a table, with the method it names. */
export interface QueryCall {
  readonly table: string
  readonly method: string
  /** Offset of the call in the file's text. */
  readonly start: number
}

/** `builder('table').method(...)` -- Knex and its clones. */
const CHAINED_CALL = /\b[A-Za-z_$][\w$]*\s*\(\s*(['"`])([A-Za-z_$][\w$.]*)\1\s*\)\s*\.\s*([A-Za-z_$][\w$]*)\b/gu

/** A table named by a builder call: `knex('payroll')`, `trx('ledger')`. */
const BUILDER_TABLE = /\b[A-Za-z_$][\w$]*\s*\(\s*(['"`])([A-Za-z_$][\w$.]*)\1\s*\)/gu

/** A table named by a `.from(...)`. */
const FROM_TABLE = /\.\s*from\s*\(\s*(?:['"`]([A-Za-z_$][\w$.]*)['"`]|([A-Za-z_$][\w$]*))\s*\)/gu

/** Every table call in a file, in source order. */
export const queryCallsIn = (text: string): ReadonlyArray<QueryCall> => {
  const found: Array<QueryCall> = []
  for (const match of text.matchAll(CHAINED_CALL)) {
    const table = match[2]
    const method = match[3]
    const start = match.index
    if (table === undefined || method === undefined || start === undefined) continue
    found.push({ table, method, start })
  }
  return found.sort((left, right) => left.start - right.start)
}

/** Every table a file names as a read, deduplicated. */
export const readsIn = (text: string): ReadonlyArray<string> => {
  const tables = new Set<string>()
  for (const match of text.matchAll(BUILDER_TABLE)) {
    const table = match[2]
    if (table !== undefined) tables.add(table)
  }
  for (const match of text.matchAll(FROM_TABLE)) {
    const table = match[1] ?? match[2]
    if (table !== undefined) tables.add(table)
  }
  return [...tables]
}
