import type { ResolvedCutlistOutput } from "@autotelic/protocol"

/*
 * `.gitattributes` is the one file `jig init` touches that a repository already owns.
 *
 * Every other file init writes is jig's: absent means write, present means keep. This one
 * may already carry `eol`, binary marks, or a vendored tree, so `init` must never replace
 * it — only merge one marked block and leave every other line exactly as it found it.
 *
 * The block is what makes committing the cutlist artifact reviewable: `linguist-generated`
 * collapses a generated file in GitHub's Files changed view, and `-diff` keeps a 6 MB SVG
 * from being rendered as a text diff. It does not make the artifact less committed; it
 * makes the part a person should review the part that shows.
 */

export const GENERATED_BEGIN = "# jig: generated artifacts — collapse in review; do not edit"
export const GENERATED_END = "# jig: end"

export type GitattributesAction = "appended" | "created" | "malformed" | "unchanged" | "updated"

export interface GitattributesMerge {
  readonly body: string
  readonly action: GitattributesAction
  readonly rules: ReadonlyArray<string>
}

/**
 * The rules for one cutlist artifact.
 *
 * `intent/` is deliberately absent: it is the one class in the artifact a person writes,
 * so a reviewer should see its diff. Everything else is a projection of the tree.
 *
 * A directory pattern needs `/**`: git applies attributes per path, and a bare directory
 * name matches the directory entry rather than its contents.
 */
export const generatedRules = (output: ResolvedCutlistOutput): ReadonlyArray<string> => {
  const rules: Array<string> = []
  for (const [key, path] of Object.entries(output)) {
    // Authored prose, and an opt-in rendering that is not being rendered: neither is a
    // generated file this repo has.
    if (key === "intent" || path === undefined) continue
    rules.push(`${key === "diagrams" ? `${path}/**` : path} linguist-generated=true`)
    // The Mermaid source is readable and worth a diff; the picture beside it is not.
    if (key === "diagrams") rules.push(`${path}/**/*.svg -diff`)
  }
  return rules
}

const blockOf = (rules: ReadonlyArray<string>, eol: string): string =>
  [GENERATED_BEGIN, ...rules, GENERATED_END].join(eol)

/**
 * Merge the managed block into a `.gitattributes`, or say why it did not.
 *
 * A block with a begin marker and no end marker is left alone: the file has been edited
 * by hand, and guessing where a person's rules resume is worse than asking.
 */
export const mergeGitattributes = (
  existing: string | undefined,
  rules: ReadonlyArray<string>,
): GitattributesMerge => {
  const eol = existing?.includes("\r\n") === true ? "\r\n" : "\n"
  const block = blockOf(rules, eol)
  if (existing === undefined || existing.trim().length === 0) {
    return { body: `${block}${eol}`, action: "created", rules }
  }
  const begin = existing.indexOf(GENERATED_BEGIN)
  const end = existing.indexOf(GENERATED_END)
  if (begin >= 0 || end >= 0) {
    if (begin >= 0 && end > begin) {
      const body = existing.slice(0, begin) + block + existing.slice(end + GENERATED_END.length)
      return { body, action: body === existing ? "unchanged" : "updated", rules }
    }
    return { body: existing, action: "malformed", rules }
  }
  const head = existing.endsWith(eol) ? existing : `${existing}${eol}`
  return { body: `${head}${eol}${block}${eol}`, action: "appended", rules }
}
