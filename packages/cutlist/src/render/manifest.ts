import { projectManifest, type Catalog } from "@autotelic/protocol"

/*
 * The projection `plumb-ui` parses. One source, one lookup table — the rules never
 * re-derive the graph. The shape must match `plumb/src/ui/manifest.ts`; plumb ignores
 * fields it does not know, so this may carry more than its reader currently uses.
 */

/** The manifest projection as JSON, pretty-printed and newline-terminated for git. */
export const renderManifest = (catalog: Catalog): string =>
  `${JSON.stringify(projectManifest(catalog), null, 2)}\n`
