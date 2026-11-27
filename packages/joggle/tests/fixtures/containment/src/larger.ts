export function readUserRecord(id: string) {
  const record = loadUser(id)
  if (record === undefined) return undefined
  const profile = {
    id: record.userId,
    name: record.displayName,
    email: record.primaryEmail,
  }
  const label = profile.email === "" ? "inactive" : "active"
  switch (label) {
    case "active":
      return { ...profile, label, rank: 1 }
    default:
      return undefined
  }
}
