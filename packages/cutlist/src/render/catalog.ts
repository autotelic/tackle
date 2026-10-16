import type { Catalog } from "@autotelic/protocol"

/** The catalog itself, pretty-printed. The full machine model a report reads. */
export const renderCatalog = (catalog: Catalog): string => `${JSON.stringify(catalog, null, 2)}\n`
