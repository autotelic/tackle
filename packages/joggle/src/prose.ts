import type { Predicate } from "effect"

/**
 * Whether a path is a Markdown document.
 *
 * Discovery uses this to route a file to `Workspace.prose` instead of the parser.
 * `.mdx` is excluded: a content mapper already compiles it to TypeScript, and a
 * second read would judge the mapper's output.
 *
 * @param file - a path discovery found.
 * @returns true when the file ends in `.md`.
 */
export const looksLikeProse: Predicate.Predicate<string> = (file) => file.endsWith(".md")

/** One sentence of prose, with where it starts and which block it belongs to. */
export interface Sentence {
  readonly text: string
  /** 1-based line in the file. */
  readonly line: number
  /**
   * The block this sentence sits in: one paragraph, one list item, one doc block.
   *
   * A judge reads a sentence with its neighbours, and a neighbour is a sentence
   * in the same block.
   */
  readonly paragraph: number
}

/** A Markdown file, read as prose. */
export interface ProseFile {
  readonly path: string
  readonly text: string
  readonly sentences: ReadonlyArray<Sentence>
}

/** One unwrapped line of prose text. */
interface Piece {
  readonly text: string
  readonly line: number
}

const FENCE = /^\s*(?:```|~~~)/
/** A line that is structure rather than prose: a heading, a table row, an HTML tag. */
const STRUCTURE = /^\s*(?:#{1,6}\s|\||<\/?[a-zA-Z!])/
const LIST_OR_QUOTE = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s?)/
const INDENTED_CODE = /^(?:\t| {4})/

/** Remove Markdown markup from one line, leaving its words. */
const stripped = (text: string): string =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_]{1,3}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()

/** The blocks of prose in a Markdown document, in order. */
const blocksOfMarkdown = (text: string): ReadonlyArray<ReadonlyArray<Piece>> => {
  const blocks: Array<ReadonlyArray<Piece>> = []
  let current: Array<Piece> = []
  const flush = (): void => {
    if (current.length > 0) blocks.push(current)
    current = []
  }
  const lines = text.split("\n")
  // Front matter is YAML between `---` lines, so it is skipped.
  let from = 0
  if (lines[0]?.trim() === "---") {
    const close = lines.indexOf("---", 1)
    if (close > 0) from = close + 1
  }
  let fence = false
  let comment = false
  // Every line of a blockquote carries its marker, so a run of them is one block.
  let quotedBefore = false
  for (let index = from; index < lines.length; index += 1) {
    const raw = lines[index] ?? ""
    if (FENCE.test(raw)) {
      fence = !fence
      flush()
      continue
    }
    if (fence) continue
    if (comment) {
      if (raw.includes("-->")) comment = false
      continue
    }
    if (raw.includes("<!--")) {
      comment = !raw.includes("-->")
      flush()
      continue
    }
    if (raw.trim() === "") {
      flush()
      continue
    }
    if (INDENTED_CODE.test(raw) || (STRUCTURE.test(raw) && !LIST_OR_QUOTE.test(raw))) {
      flush()
      continue
    }
    const quoted = /^\s*>/.test(raw)
    const item = LIST_OR_QUOTE.test(raw)
    const body = stripped(raw.replace(LIST_OR_QUOTE, ""))
    if (body === "") continue
    // A list item opens a block, and a quoted line opens one unless the line
    // before it was quoted too. A wrapped continuation line joins either.
    if ((item || quoted) && !(quoted && quotedBefore)) flush()
    quotedBefore = quoted
    current.push({ text: body, line: index + 1 })
  }
  flush()
  return blocks
}

/** An abbreviation whose period does not end a sentence. */
const ABBREVIATION = /(?:^|\s)(?:e\.g|i\.e|etc|vs|cf|approx|ref|fig|dr|mr|ms|st|inc|ltd|jr|sr|al|resp)\.$/i

/** A sentence boundary: punctuation, whitespace, then a capital or a digit. */
const SENTENCE_END = /[.!?][")'\]]?(?=\s+["“'([]?[A-Z0-9])/g

/** The sentences of one block, with each one's starting line. */
const sentencesOfBlock = (
  pieces: ReadonlyArray<Piece>,
  paragraph: number,
): ReadonlyArray<Sentence> => {
  const buffer = pieces.map((piece) => piece.text).join(" ")
  const starts: Array<{ readonly offset: number; readonly line: number }> = []
  let offset = 0
  for (const piece of pieces) {
    starts.push({ offset, line: piece.line })
    offset += piece.text.length + 1
  }
  const lineAt = (at: number): number => {
    let found = pieces[0]?.line ?? 1
    for (const start of starts) {
      if (start.offset > at) break
      found = start.line
    }
    return found
  }
  const sentences: Array<Sentence> = []
  let cursor = 0
  const push = (end: number): void => {
    const raw = buffer.slice(cursor, end)
    const text = raw.trim()
    // The leading space is trimmed, so the line comes from the first non-space
    // character.
    if (text !== "") sentences.push({ text, line: lineAt(cursor + raw.length - raw.trimStart().length), paragraph })
    cursor = end
  }
  for (const match of buffer.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length
    const before = buffer.slice(Math.max(0, match.index - 8), match.index + 1)
    if (ABBREVIATION.test(before)) continue
    push(end)
  }
  push(buffer.length)
  return sentences
}

/**
 * The sentences of a Markdown document.
 *
 * Code fences, tables, headings, HTML, front matter and indented code are
 * skipped: a sentence inside a code sample was not written as documentation.
 *
 * @param text - the document.
 * @returns every prose sentence, in document order.
 */
export const sentencesOfMarkdown = (text: string): ReadonlyArray<Sentence> =>
  blocksOfMarkdown(text).flatMap((block, index) => sentencesOfBlock(block, index))

/**
 * The sentences of a doc comment's prose.
 *
 * `@param` and `@returns` are dropped. The type checker reads that contract, and a
 * tag's wording is a specification rather than prose.
 *
 * @param doc - the comment text, with the leading `*` already stripped.
 * @returns every prose sentence, in comment order.
 */
export const sentencesOfDoc = (doc: string): ReadonlyArray<Sentence> => {
  const lines = doc.split("\n")
  const block = lines
    .map((line, index) => ({ text: stripped(line), line: index + 1, tag: line.trim().startsWith("@") }))
    .filter((entry) => !entry.tag && entry.text !== "")
  // A blank line is dropped, so a doc block's sentences form one sequence. The
  // line numbers still point into the comment.
  return sentencesOfBlock(
    block.map((entry) => ({ text: entry.text, line: entry.line })),
    0,
  )
}
