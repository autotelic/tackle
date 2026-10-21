import { projectManifest, type Catalog, type Intent } from "@autotelic/protocol"

/*
 * The projection `plumb-ui` parses. One source, one lookup table — the rules never
 * re-derive the graph. The shape must match `plumb/src/ui/manifest.ts`; plumb ignores
 * fields it does not know, so this may carry more than its reader currently uses.
 */

/**
 * The manifest projection as JSON, pretty-printed and newline-terminated for git.
 *
 * Intent is joined here as well as in the menu: a lint rule that cannot see a part's
 * lifecycle can only describe its shape, not whether importing it is still allowed.
 */
export const renderManifest = (
  catalog: Catalog,
  intent: ReadonlyMap<string, Intent> | undefined,
): string => `${JSON.stringify(projectManifest(catalog, intent), null, 2)}\n`
