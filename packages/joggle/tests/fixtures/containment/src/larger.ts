export function readUserRecord(id: string, includeDeleted: boolean) {
  const record = loadUser(id, includeDeleted)
  if (record === undefined) return undefined
  const normalized = normalizeUser(record)
  if (normalized === undefined) return undefined
  return normalized
}
