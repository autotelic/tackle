import { normalise, save, validate, type Row } from "./helper.ts"

/** The same three calls, inlined, with a name of its own. */
export function cleanInline(row: Row): Row {
  const first = normalise(row)
  const second = validate(first)
  return save(second)
}
