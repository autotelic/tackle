import type { Predicate } from "effect"

/**
 * Glob to a regular-expression source, shared by the config matcher, the
 * gitignore matcher and the tsconfig scope.
 *
 * The two have the same character loop and differ in exactly two ways, so those
 * are options rather than a second implementation:
 *
 *   question              whether a question mark is one non-separator character.
 *                         Gitignore says yes; a declared layer path says no.
 *   doubleStarSkipsSlash  whether a double star followed by a slash absorbs the
 *                         slash, so it matches zero directories as well as
 *                         several. Gitignore says yes.
 */
export interface GlobSyntax {
  readonly question: boolean
  readonly doubleStarSkipsSlash: boolean
}

const SPECIAL = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "?", "\\"])

const escape = (text: string): string =>
  text
    .split("")
    .map((character) => (SPECIAL.has(character) ? "\\" + character : character))
    .join("")

/**
 * The regular-expression source for a glob pattern.
 *
 * @param pattern - The glob, without a leading or trailing delimiter.
 * @param syntax - Which of the two behaviours to apply.
 * @returns A regex source the caller anchors and compiles.
 */
export const globSource = (pattern: string, syntax: GlobSyntax): string => {
  let source = ""
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*"
        index += 1
        if (syntax.doubleStarSkipsSlash && pattern[index + 1] === "/") index += 1
      } else {
        source += "[^/]*"
      }
    } else if (character === "?" && syntax.question) {
      source += "[^/]"
    } else {
      source += escape(character ?? "")
    }
  }
  return source
}

const WILDCARD = /[*?]/

/**
 * A tsconfig `include` or `exclude` entry as a predicate over root-relative paths.
 *
 * An entry with no wildcard names a file or a directory, and a directory covers
 * everything under it, as the compiler reads it. A wildcard entry follows
 * gitignore's syntax: `src/**\/*` matches `src/a.astro` as well as deeper files.
 */
export const tsconfigEntry = (entry: string): Predicate.Predicate<string> => {
  const pattern = entry.replace(/^\.\//, "").replace(/\/$/, "")
  if (!WILDCARD.test(pattern)) return (file) => file === pattern || file.startsWith(pattern + "/")
  const regex = new RegExp("^" + globSource(pattern, { question: true, doubleStarSkipsSlash: true }) + "$")
  return (file) => regex.test(file)
}
