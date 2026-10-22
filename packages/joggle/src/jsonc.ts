/*
 * JSON with comments and trailing commas, as tsconfig is written.
 *
 * `tsconfig.json` is JSONC by specification, and a strict `JSON.parse` turns a
 * commented config into "no configuration" -- which is indistinguishable from a
 * config that declares nothing. That is the wrong direction for a tool whose
 * job is to notice what it did not look at.
 *
 * This is a scanner, not a regex: `//` inside a string is a string, and a
 * trailing comma is only trailing if the next structural character is `}` or
 * `]`. It does not validate; the schema decoder does that after.
 */

/** Copy one string literal, including its quotes and escapes. */
const stringAt = (text: string, start: number) => {
  let index = start + 1
  while (index < text.length) {
    const character = text[index]
    if (character === "\\") {
      index += 2
      continue
    }
    if (character === '"') return { text: text.slice(start, index + 1), end: index + 1 }
    index += 1
  }
  return { text: text.slice(start), end: text.length }
}

/** Remove comments, preserving newlines so a diagnostic still points at a line. */
const withoutComments = (text: string): string => {
  let out = ""
  let index = 0
  while (index < text.length) {
    const character = text[index]
    const next = text[index + 1]
    if (character === '"') {
      const literal = stringAt(text, index)
      out += literal.text
      index = literal.end
      continue
    }
    if (character === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1
      continue
    }
    if (character === "/" && next === "*") {
      index += 2
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        if (text[index] === "\n") out += "\n"
        index += 1
      }
      index += 2
      continue
    }
    out += character
    index += 1
  }
  return out
}

/** Remove a comma whose next structural character closes an object or array. */
const withoutTrailingCommas = (text: string): string => {
  let out = ""
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '"') {
      const literal = stringAt(text, index)
      out += literal.text
      index = literal.end
      continue
    }
    if (character === ",") {
      let look = index + 1
      while (look < text.length && /\s/u.test(text[look] ?? "")) look += 1
      const next = text[look]
      if (next === "}" || next === "]") {
        index += 1
        continue
      }
    }
    out += character
    index += 1
  }
  return out
}

/**
 * Strip the parts of JSONC that `JSON.parse` rejects.
 *
 * @param text - The file's text, as written.
 * @returns Text a strict JSON parser accepts, or the original when it cannot be
 *   scanned (the decoder will reject it either way).
 */
export const stripJsonc = (text: string): string => withoutTrailingCommas(withoutComments(text))
