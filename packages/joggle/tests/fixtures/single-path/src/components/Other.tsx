import { formatDollar } from "../utils/money"

export function Summary({ amount }: { amount: number }) {
  return <p>{formatDollar(amount)}</p>
}
