interface Row {
  readonly personId: string | null
  readonly amount: number
}

/** A test helper that skips rows, like the path under test. */
export function testRows(rows: ReadonlyArray<Row>): ReadonlyArray<Row> {
  const kept: Array<Row> = []
  for (const row of rows) {
    if (row.personId === null) continue
    kept.push(row)
  }
  return kept
}
