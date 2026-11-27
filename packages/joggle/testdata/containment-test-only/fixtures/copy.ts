export function buildUserLabel(id: string) {
  const record = loadUser(id)
  if (record === undefined) return undefined
  const label = record.email === "" ? "inactive" : "active"
  return label
}
