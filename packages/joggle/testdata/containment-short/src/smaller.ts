export function readLabel(id: string) {
  const record = loadUser(id)
  return record?.label
}
