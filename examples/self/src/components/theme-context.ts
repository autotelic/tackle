import { createContext } from "react"

/*
 * Part one of a tripartite context: the context object, alone in its module, so the
 * provider file and the hook file can both depend on it without depending on each other.
 * `plumb-react/require-tripartite-context` is the rule that keeps this shape.
 */

export type Theme = "light" | "dark"

export interface ThemeContextValue {
  readonly theme: Theme
  readonly setTheme: (theme: Theme) => void
}

/** The context the provider fills and the hook reads. Default: light, and a no-op setter. */
export const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  setTheme: () => undefined,
})
