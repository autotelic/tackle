export function describeAccount(account: Account) {
  const label = account.email === "" ? "inactive" : "active"
  const tier = account.plan === "pro" ? "paid" : "free"
  if (account.suspended) {
    return { label, tier, state: "suspended" }
  }
  if (account.invited) {
    return { label, tier, state: "invited" }
  }
  if (account.archived) {
    return { label, tier, state: "archived" }
  }
  if (account.deleted) {
    return { label, tier, state: "deleted" }
  }
  if (account.migrating) {
    return { label, tier, state: "migrating" }
  }
  if (account.overdue) {
    return { label, tier, state: "overdue" }
  }
  if (account.trialing) {
    return { label, tier, state: "trialing" }
  }
  if (account.pending) {
    return { label, tier, state: "pending" }
  }
  return { label, tier, state: "active" }
}
