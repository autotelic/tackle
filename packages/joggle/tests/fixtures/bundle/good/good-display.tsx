import { useGood } from "./good-context"

export function GoodDisplay() {
  const { state } = useGood()
  return <span>{state.count}</span>
}
