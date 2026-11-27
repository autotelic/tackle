export function describeAccount(account: Account) {
  const label = account.email === "" ? "inactive" : "active"
  const tier = account.plan === "pro" ? "paid" : "free"
  if (account.suspended) {
    return { label, tier, state: "suspended" }
  }
  if (account.invited) {
    return { label, tier, state: "invited" }
  }
  if (account.pending) {
    return { label, tier, state: "pending" }
  }
  return { label, tier, state: "active" }
}
