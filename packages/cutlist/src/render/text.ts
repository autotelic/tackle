/*
 * Small text helpers the renderers share.
 *
 * `plural` was written twice -- once for the menu and once for the patterns view -- because
 * each renderer was written on its own. It is one rule about English, so it lives in one
 * place and both renderers read it.
 */

/**
 * A count with its singular or plural form.
 *
 * @param count - The number to print.
 * @param forms - The `[singular, plural]` spellings.
 * @returns The count and the matching form, e.g. `3 parts`.
 */
export const plural = (count: number, forms: readonly [one: string, many: string]): string =>
  String(count) + " " + (count === 1 ? forms[0] : forms[1])

/** A comma list of backticked names, limited, with a remainder count. */
export const some = (items: ReadonlyArray<string>, limit: number): string => {
  const shown = items
    .slice(0, limit)
    .map((item) => "`" + item + "`")
    .join(", ")
  const rest = items.length - limit
  return rest > 0 ? shown + " +" + String(rest) + " more" : shown
}
