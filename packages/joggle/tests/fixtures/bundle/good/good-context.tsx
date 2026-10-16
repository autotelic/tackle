import { createContext, useContext } from "react"

export interface GoodValue {
  state: { count: number }
  actions: { bump: () => void }
  meta: { max: number }
}

export const GoodContext = createContext<GoodValue | undefined>(undefined)

export function useGood(): GoodValue {
  const context = useContext(GoodContext)
  if (!context) throw new Error("Good.* must be within Good.Provider")
  return context
}
