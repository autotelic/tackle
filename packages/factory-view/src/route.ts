import { Data } from "effect"

/** The path a workstream panel is shared at. A panel is a filter, so the path names it. */
export const workstreamPath = (id: string): string =>
  "/factory/workstream/" + encodeURIComponent(id)

const PREFIX = "/factory/workstream/"

/** What a browser path selects: one panel, or the overview (including a malformed path). */
export type PanelPath = Data.TaggedEnum<{
  readonly Panel: { readonly id: string }
  readonly None: {}
}>

const PanelPath = Data.taggedEnum<PanelPath>()

/**
 * The workstream id a path selects, or none for the overview.
 *
 * @param path - the browser path (or a test's path).
 * @returns the decoded id, or none when the path is not exactly one panel.
 */
export const workstreamOfPath = (path: string): PanelPath => {
  const clean = path.replace(/\/+$/u, "")
  if (!clean.startsWith(PREFIX)) return PanelPath.None()
  const rest = clean.slice(PREFIX.length)
  if (rest === "" || rest.includes("/")) return PanelPath.None()
  // SAFETY: decodeURIComponent is a parse boundary; a malformed escape is not an id.
  try {
    return PanelPath.Panel({ id: decodeURIComponent(rest) })
  } catch {
    return PanelPath.None()
  }
}
