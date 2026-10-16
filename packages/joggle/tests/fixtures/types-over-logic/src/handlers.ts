/**
 * Three guards on wide types: one that a type should carry, one that IS the
 * boundary, and one about runtime state. The shape is the fact; which it is is
 * the question.
 */
export function sendReceipt(orderId: string, email: string) {
  if (!email) {
    throw new Error("no email")
  }
  return deliver(orderId, email)
}

export function parseEmail(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("not a string")
  }
  return raw
}

export function renderBanner(request: { user?: { name: string } }) {
  const user = request.user
  if (!user) {
    return null
  }
  return user.name
}
