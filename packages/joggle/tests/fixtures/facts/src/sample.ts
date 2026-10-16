export function label(amount: number, total: number): string {
  if (amount === 0) {
    return "nothing"
  }
  return `$${amount.toFixed(2)} of ${total}`
}

export function suffix(total: number): string {
  return total + " km"
}
