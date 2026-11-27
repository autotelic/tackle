/*
 * Astro support: an `.astro` file becomes a TSX module the existing parser already reads.
 *
 * An Astro component is a frontmatter script between two `---` fences, then an HTML-like
 * template. The template is JSX-shaped (`{expr}`, `<Component prop={x} />`, `set:html`,
 * `class:list`), so the cheapest faithful reading is to wrap it as the body of a default-exported
 * function and let the same pass that reads React read it: imports, rendered tags with lines,
 * the default export. Nothing about the catalog changes.
 *
 * The rewrite keeps every character offset and newline where it was. Rendered-tag line numbers
 * come from the parsed positions, so a line that moved would point a reader at the wrong place.
 */

/** The two halves of a file, split at the closing frontmatter fence. */
export interface AstroParts {
  /** Everything up to and including the closing fence, with both fences blanked. */
  readonly script: string
  /** The template: whatever follows the closing fence, unchanged. */
  readonly template: string
}

/** Replace every character except line breaks with a space, so offsets and lines survive. */
const blank = (text: string): string => text.replace(/[^\r\n]/gu, " ")

const OPENING_FENCE = /^\s*---[ \t]*\r?\n/u
const CLOSING_FENCE = /(^|\n)---[ \t]*(?=\r?\n|$)/u

/**
 * Split a file at its frontmatter fences.
 *
 * Only a fence at the very top counts: a `---` further down is template text (a markdown rule,
 * a comment), and treating it as frontmatter would swallow markup.
 */
export const splitAstro = (text: string): AstroParts => {
  const opening = OPENING_FENCE.exec(text)
  if (opening === null) return { script: "", template: text }
  const afterOpening = opening[0].length
  const closing = CLOSING_FENCE.exec(text.slice(afterOpening - 1))
  // An unterminated fence is a syntax error in Astro too; read the rest as script rather than
  // invent a template.
  if (closing === null)
    return { script: blank(opening[0]) + text.slice(afterOpening), template: "" }
  const newline = closing[1] ?? ""
  const scriptEnd = afterOpening - 1 + closing.index + newline.length
  const fenceEnd = scriptEnd + closing[0].length - newline.length
  return {
    script:
      blank(opening[0]) +
      text.slice(afterOpening, scriptEnd) +
      blank(text.slice(scriptEnd, fenceEnd)),
    template: text.slice(fenceEnd),
  }
}

/** HTML void elements: legal unclosed in Astro, a syntax error in JSX. */
const VOID_TAG =
  /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s(?:[^<>{}]|\{[^{}]*\})*?)?(?<!\/)>/giu

/**
 * Rewrite the template so a JSX parser accepts it, without moving a line.
 *
 * - `<style>` and `<script>` bodies are CSS and browser JavaScript, not template; their braces
 *   would read as expressions, so the whole element is blanked.
 * - HTML comments and the doctype are not JSX.
 * - Void elements are self-closed.
 */
export const jsxFriendly = (template: string): string =>
  template
    .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/giu, blank)
    .replace(/<!--[\s\S]*?-->/gu, blank)
    .replace(/<!doctype[^>]*>/giu, blank)
    .replace(VOID_TAG, (whole) => `${whole.slice(0, -1)} />`)

/**
 * The module the shared parser reads for an `.astro` file.
 *
 * The frontmatter is module code, so its imports and exports parse as such. The template becomes
 * the return value of the default export, which is also what makes the part a component. The
 * wrapper opens on the closing-fence line, so no line number moves.
 */
export const astroToTsx = (text: string): string => {
  const { script, template } = splitAstro(text)
  // An anonymous default export: no identifier to collide with one the frontmatter declares.
  return `${script}export default () => (<>${jsxFriendly(template)}</>)\n`
}
