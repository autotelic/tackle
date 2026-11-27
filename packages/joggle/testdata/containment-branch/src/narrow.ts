export function describeAccountSummary(account: Account) {
  const label = account.email === "" ? "inactive" : "active"
  const tier = account.plan === "pro" ? "paid" : "free"
  if (account.pending) {
    return { label, tier, state: "pending" }
  }
  return { label, tier, state: "active" }
}
