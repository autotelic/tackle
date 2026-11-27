export function readUserRecord(id: string) {
  const record = loadUser(id)
  if (record === undefined) return undefined
  const label = record.email === "" ? "inactive" : "active"
  const rank = label === "active" ? 1 : 0
  const verified = record.verifiedAt !== undefined
  const source = record.directorySource ?? "local"
  const status = record.status ?? "active"
  const tags = [...record.tags, label, source]
  const summary = { record, label, rank, verified, source, status, tags }
  audit("readUserRecord", summary)
  return { ...summary, label, rank, verified, source, status, tags }
}
