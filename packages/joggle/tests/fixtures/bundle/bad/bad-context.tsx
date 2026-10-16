import { createContext } from "react"

export const BadContext = createContext<unknown>(undefined)

// A hook, but one that never reads the context it is named after.
export function useBad() {
  return { state: {}, actions: {}, meta: {} }
}
