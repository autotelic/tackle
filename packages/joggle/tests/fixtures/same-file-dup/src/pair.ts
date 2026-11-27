/**
 * Two declarations, one file, one body — the shape `distinctFiles: true` made
 * invisible. `bundles.ts` carried exactly this: `blocksIn` and `declares`, three
 * lines apart, identical.
 */
export const firstNames = (items: ReadonlyArray<{ name: string }>): ReadonlyArray<string> =>
  items.filter((item) => item.name !== "").map((item) => item.name)

export const otherNames = (items: ReadonlyArray<{ name: string }>): ReadonlyArray<string> =>
  items.filter((item) => item.name !== "").map((item) => item.name)
