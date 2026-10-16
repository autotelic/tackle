import { useState, type ReactNode } from "react"
import { BadContext } from "./bad-context"

export function BadProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0)
  const bump = () => setCount((current) => current + 1)
  return (
    <BadContext.Provider value={{ state: { count }, actions: { bump }, extra: true }}>
      {children}
    </BadContext.Provider>
  )
}
