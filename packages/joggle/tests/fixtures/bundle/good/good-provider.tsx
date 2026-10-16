import { useState, type ReactNode } from "react"
import { GoodContext } from "./good-context"

export function GoodProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0)
  const bump = () => setCount((current) => current + 1)
  return (
    <GoodContext.Provider value={{ state: { count }, actions: { bump }, meta: { max: 10 } }}>
      {children}
    </GoodContext.Provider>
  )
}
