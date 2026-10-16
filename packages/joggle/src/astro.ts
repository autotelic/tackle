import type { Predicate } from "effect"
import type { FileText } from "./workspace.ts"

/*
 * The TypeScript inside an `.astro` file, located so the parser can read it in place.
 *
 * An `.astro` file is frontmatter, a template, and `<script>` blocks. The
 * frontmatter and the scripts are TypeScript; the template needs Astro's own
 * compiler and is not read. Rather than cutting the TypeScript out and mapping
 * positions back, everything else is blanked: the copy has the same length and
 * the same line breaks, so an offset into it is an offset into the file.
 */

/** A span of the file, in UTF-16 code units, end exclusive. */
export interface Region {
  readonly start: number
  readonly end: number
}

const OPENING_FENCE = /^\s*---[ \t]*\r?\n/
const CLOSING_FENCE = /^---[ \t]*\r?$/m
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const TYPE = /\btype\s*=\s*["']?([^"'\s>]+)/i
const READABLE_TYPES = new Set(["module", "text/javascript", "application/javascript"])

/** Whether a script's attributes say its content is code joggle should read. */
const readableScript = (attributes: string): boolean => {
  if (/\bset:(?:html|text)\b/.test(attributes)) return false
  const type = TYPE.exec(attributes)?.[1]
  return type === undefined || READABLE_TYPES.has(type.toLowerCase())
}

/**
 * The frontmatter's content, then each readable script's content.
 *
 * The frontmatter only counts at the top of the file, as Astro reads it, so a
 * `---` further down is template text. Scripts are searched for after the
 * frontmatter: a `<script>` string inside the frontmatter is TypeScript.
 */
export const astroRegions = (text: string): ReadonlyArray<Region> => {
  const regions: Array<Region> = []
  let templateStart = 0
  const opening = OPENING_FENCE.exec(text)
  if (opening !== null) {
    const start = opening[0].length
    const closing = CLOSING_FENCE.exec(text.slice(start))
    if (closing !== null) {
      regions.push({ start, end: start + closing.index })
      templateStart = start + closing.index + closing[0].length
    }
  }
  for (const match of text.slice(templateStart).matchAll(SCRIPT)) {
    const attributes = match[1] ?? ""
    const content = match[2] ?? ""
    if (!readableScript(attributes)) continue
    const start = templateStart + match.index + match[0].indexOf(">") + 1
    regions.push({ start, end: start + content.length })
  }
  return regions
}

/** The file with every character outside the regions a space, and every newline kept. */
export const blankOutside = (text: string, regions: ReadonlyArray<Region>): string => {
  const blank = (from: number, to: number): string => text.slice(from, to).replace(/[^\r\n]/g, " ")
  let out = ""
  let cursor = 0
  for (const region of regions) {
    out += blank(cursor, region.start) + text.slice(region.start, region.end)
    cursor = region.end
  }
  return out + blank(cursor, text.length)
}

/**
 * The name Astro gives a component: its file's, as an identifier.
 *
 * Every component declares `interface Props`, and Astro reads it by that name,
 * so it is never imported elsewhere. Thirty-five units all called `Props` read
 * to the name rules as one concept spelled thirty-five times.
 */
export const componentName = (file: string): string => {
  const base = (file.split("/").at(-1) ?? file).replace(/\.astro$/, "")
  const words = base.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ?? "").toUpperCase())
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A path to an Astro component or page. */
export const isAstro: Predicate.Predicate<string> = (file) => file.endsWith(".astro")

/** What the parser reads for a file: the blanked copy for `.astro`, the text otherwise. */
export const parseInputOf = ({ file, text }: FileText): string =>
  isAstro(file) ? blankOutside(text, astroRegions(text)) : text

/**
 * oxc's message for a `return` outside a function. Astro frontmatter may
 * `return Astro.redirect(...)`, and oxc still returns the whole tree with it.
 */
const TOP_LEVEL_RETURN = "A 'return' statement can only be used within a function body."

/** The errors that make a parse unusable: for `.astro`, all but a top-level `return`. */
export const blockingErrors = <E extends { readonly message: string }>(
  file: string,
  errors: ReadonlyArray<E>,
): ReadonlyArray<E> => (isAstro(file) ? errors.filter((error) => error.message !== TOP_LEVEL_RETURN) : errors)
