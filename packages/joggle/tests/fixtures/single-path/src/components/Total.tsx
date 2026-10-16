import { formatDollar } from "../utils/money"

export function Total({ amount }: { amount: number }) {
  return <span>{formatDollar(amount)}</span>
}

export function Labelled({ amount }: { amount: number }) {
  const label = `$${amount.toFixed(2)}`
  return <span>{label}</span>
}
