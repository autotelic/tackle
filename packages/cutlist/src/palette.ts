/*
 * Palette import — an external color set becomes the repo's declared token source.
 *
 * `cutlist` reads tokens from the repo (a Tailwind config's keys, a stylesheet's color
 * variables) and publishes them as the closed set in `tokens.md`, which `plumb-ui`
 * then enforces. Neither can act while the palette lives in a vendor's JSON with
 * `050`-style shades and `//` comments. This module is the deterministic bridge in:
 * the palette file is the input, a Tailwind v4 `@theme` block is the output, and the
 * shade numbers are normalized to the 50–900 scale the utilities expect.
 *
 * The conversion is line-oriented so the palette's own group comments survive as CSS
 * comments in file order, and it is strict in the other direction: any line that is
 * not blank, a brace, a comment, or a `"name": "value"` entry is a failure, not a
 * guess — a palette that half-imports is a token set you cannot trust.
 */

/** The result of converting one palette file. */
export type PaletteRender =
  | { readonly ok: true; readonly css: string; readonly colors: ReadonlyArray<string> }
  | { readonly ok: false; readonly reason: string }

/** A `"name": "value"` line, with an optional trailing comment. */
const ENTRY = /^\s*"([^"]+)"\s*:\s*"([^"]+)"\s*,?\s*(?:\/\/\s*(.*))?$/u

/** A line that is only a comment. */
const WHOLE_COMMENT = /^\s*\/\/\s*(.*)$/u

/** A line that is only the object's braces. */
const STRUCTURAL = /^\s*[{}],?\s*$/u

/**
 * The utility-class shade scale, from the palette file's.
 *
 * Vendor palettes number their lightest shade `050`; the class utilities it feeds
 * (`bg-cyan-50`) expect `50`. Other names pass through untouched.
 *
 * @param name - The palette entry's name, e.g. `cyan-050`.
 * @returns The token name, e.g. `cyan-50`.
 */
export const normalizeShadeName = (name: string): string => name.replace(/-0*(\d+)$/u, "-$1")

/**
 * Convert one palette file's text into a Tailwind v4 `@theme` block.
 *
 * @param input - The palette file's contents.
 * @returns The rendered block and the token names it declares, or the failure's reason.
 */
export const paletteToTheme = ({ input }: { input: string }): PaletteRender => {
  const body: Array<string> = []
  const colors: Array<string> = []
  const lines = input.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    if (line.trim() === "" || STRUCTURAL.test(line)) continue
    const comment = WHOLE_COMMENT.exec(line)
    if (comment !== null) {
      const text = comment[1]?.trim()
      if (text !== undefined && text !== "") body.push(`  /* ${text} */`)
      continue
    }
    const entry = ENTRY.exec(line)
    if (entry !== null) {
      const rawName = entry[1]
      const value = entry[2]
      if (rawName === undefined || value === undefined) {
        return { ok: false, reason: `line ${index + 1}: ${line.trim()}` }
      }
      const name = normalizeShadeName(rawName)
      colors.push(name)
      const inline = entry[3]?.trim()
      body.push(
        `  --color-${name}: ${value};${inline === undefined || inline === "" ? "" : ` /* ${inline} */`}`,
      )
      continue
    }
    return { ok: false, reason: `line ${index + 1}: ${line.trim()}` }
  }
  if (colors.length === 0) return { ok: false, reason: "no color entries found" }
  return { ok: true, css: ["@theme {", ...body, "}", ""].join("\n"), colors }
}
