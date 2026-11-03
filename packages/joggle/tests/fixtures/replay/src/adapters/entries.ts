interface Entry {
  readonly ledgerId: string | null
  readonly cents: number
}

/** Drops entries with no ledger, and says nothing about them. */
export function adaptEntries(entries: ReadonlyArray<Entry>): ReadonlyArray<Entry> {
  const kept: Array<Entry> = []
  for (const entry of entries) {
    if (entry.ledgerId === null) continue
    kept.push(entry)
  }
  return kept
}
