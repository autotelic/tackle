export function readName(id: string) {
  const record = loadUser(id)
  return record?.displayName
}
