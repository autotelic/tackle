import { useContext } from "react"
import { ThemeContext } from "./theme-context.ts"

/*
 * Part three: the hook. `hookPrefix: "use"` is declared in `cutlist.config.json`, which is
 * how the crawler knows `useTheme` is part of the context's contract and not just a
 * function that starts with those three letters by coincidence.
 */

/** Reads the theme the nearest `ThemeProvider` supplies. */
export const useTheme = () => useContext(ThemeContext)
