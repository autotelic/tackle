import { useMemo, useState } from "react"
import type { ReactNode } from "react"
import { ThemeContext, type Theme } from "./theme-context.ts"

/*
 * Part two: the provider. Its name ends in `Provider` because that is the suffix
 * `cutlist.config.json` declares for the composition pattern, so `joggle` can tell a
 * provider from a component that merely happens to be called something similar.
 */

export interface ThemeProviderProps {
  readonly children?: ReactNode
}

/** Supplies the current theme to everything below it. */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>("light")
  const value = useMemo(() => ({ theme, setTheme }), [theme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
