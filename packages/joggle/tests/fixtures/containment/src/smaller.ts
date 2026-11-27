export function readUserRecordOrUndefined(id: string, includeDeleted: boolean) {
  const record = loadUser(id, includeDeleted)
  return record
}
