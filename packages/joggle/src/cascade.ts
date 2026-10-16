import type { Edit } from "./schema.ts"
import { lineStarts, type Unit, type Workspace } from "./workspace.ts"

/**
 * The 1-based line of a character offset.
 *
 * @param starts - The offsets from {@link lineStarts}.
 * @param offset - The character offset to locate.
 * @returns The 1-based line number.
 */
export const lineAt = (starts: ReadonlyArray<number>, offset: number): number => {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((starts[middle] ?? 0) <= offset) low = middle
    else high = middle - 1
  }
  return low + 1
}

/**
 * Every site that must change when `keep` replaces `drops`.
 *
 * Three walks, because there are three ways to name a declaration: the import,
 * the call, and the type. Code computes all three.
 *
 * This is the half of a repair the model must never produce. A model that listed
 * forty-seven call sites would invent some of them, and an invented site is a
 * broken edit that looks exactly like a real one. The model decides identity --
 * these declarations are one thing -- and this decides what that costs.
 *
 * @param workspace - The analysed workspace, whose graphs carry the edges.
 * @param keep - The declaration that survives.
 * @param drops - The declarations that go.
 * @returns The edits, in the order a person would make them: imports, calls, types.
 */
export const cascadeOf = (
  workspace: Workspace,
  keep: Unit,
  drops: ReadonlyArray<Unit>,
): ReadonlyArray<Edit> => {
  const edits: Array<Edit> = []
  const seen = new Set<string>()
  const starts = new Map<string, ReadonlyArray<number>>()
  const push = (edit: Edit): void => {
    const key = [edit.file, edit.line, edit.column, edit.instruction].join("\u0000")
    if (seen.has(key)) return
    seen.add(key)
    edits.push(edit)
  }
  const startsOf = (file: string, text: string): ReadonlyArray<number> => {
    const known = starts.get(file)
    if (known !== undefined) return known
    const found = lineStarts(text)
    starts.set(file, found)
    return found
  }

  for (const drop of drops) {
    const identity = drop.file + "#" + drop.name

    // 1. The importers. They must take the survivor's name from the survivor.
    for (const edge of workspace.imports.importersOfName(drop.file, drop.name)) {
      push({
        file: edge.importer,
        line: 1,
        column: 1,
        instruction:
          "import `" + keep.name + "` from `" + keep.file + "` instead of `" +
          drop.name + "` from `" + drop.file + "`",
      })
    }

    // 2. The call sites. `unit.calls` is built from the same filter in the same
    // order, so the index pairs a resolved callee with the span that made it.
    for (const file of workspace.files) {
      for (const unit of file.units) {
        const sites = file.facts.callSites.filter(
          (site) => site.start >= unit.start && site.end <= unit.end,
        )
        sites.forEach((site, index) => {
          if (unit.calls[index] !== identity) return
          push({
            file: file.path,
            line: lineAt(startsOf(file.path, file.text), site.start),
            column: 1,
            instruction: "call `" + keep.name + "` in " + keep.file,
          })
        })
      }
    }

    // 3. The type names, so the shape follows the name.
    for (const unit of workspace.units) {
      if (!unit.typeSignature.split("|").includes(identity)) continue
      push({
        file: unit.file,
        line: unit.location.line,
        column: 1,
        instruction: "`" + drop.name + "` now resolves to " + keep.file,
      })
    }
  }

  return edits
}
