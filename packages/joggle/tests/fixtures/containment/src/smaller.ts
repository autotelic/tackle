export function readUserName(id: string) {
  const record = loadUser(id)
  if (record === undefined) return undefined
  return record
}
