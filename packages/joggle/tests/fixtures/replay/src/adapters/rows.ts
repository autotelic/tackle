interface Row {
  readonly personId: string | null
  readonly amount: number
}

/** Drops rows it cannot place, and says nothing about them. */
export function adaptRows(rows: ReadonlyArray<Row>): ReadonlyArray<Row> {
  const kept: Array<Row> = []
  for (const row of rows) {
    if (row.personId === null) continue
    kept.push(row)
  }
  return kept
}
