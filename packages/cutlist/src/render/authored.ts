import { Array, Option } from "effect"
import type { PartStatus } from "@autotelic/protocol"

/*
 * The authored half of a rendering.
 *
 * A menu entry and a pattern both carry the same authored fields: what a part is for, when
 * to reach for it, what to reach for instead. The two renderers printed them in the same
 * order from two copies of the same function. The fields and their order are one idea, so
 * they live here and both renderers read them.
 */

/** The authored fields a rendering prints, in the order a reader meets them. */
export interface AuthoredIntent {
  readonly summary?: string
  readonly whenToUse?: string
  readonly whenNotToUse?: string
  readonly states?: ReadonlyArray<string>
  readonly status?: PartStatus
  readonly examples?: ReadonlyArray<string>
  readonly useInstead?: ReadonlyArray<string>
}

/** The line for a present string, or no line when the field is absent. */
const lineOf = (
  value: string | undefined,
  render: (present: string) => string,
): Option.Option<string> => Option.map(Option.fromNullishOr(value), render)

/** The line for a present, non-empty list, or no line when it is absent or empty. */
const listLineOf = (
  values: ReadonlyArray<string> | undefined,
  render: (present: string) => string,
): Option.Option<string> =>
  Option.flatMap(Option.fromNullishOr(values), (present) =>
    present.length === 0 ? Option.none() : Option.some(render(Array.join(present, ", "))),
  )

/**
 * The authored lines of an entry or pattern, in reader order.
 *
 * A `filterMap`: every field is lifted to an `Option`, an absent one drops out, and
 * `Array.getSomes` keeps the present lines in the order they are listed. The alternative
 * is a mutable accumulator pushed to behind seven `if`s, which is the same computation
 * spelled as control flow.
 *
 * @param entry - The entry or pattern carrying authored intent.
 * @returns One line per authored field that is present.
 */
export const authoredLines = (entry: AuthoredIntent): ReadonlyArray<string> =>
  Array.getSomes([
    Option.fromNullishOr(entry.summary),
    lineOf(entry.whenToUse, (value) => `when: ${value}`),
    lineOf(entry.whenNotToUse, (value) => `avoid: ${value}`),
    listLineOf(entry.states, (value) => `states: ${value}`),
    lineOf(entry.status, (status) => `status: ${status}`),
    listLineOf(entry.examples, (value) => `examples: ${value}`),
    listLineOf(entry.useInstead, (value) => `use ${value} instead`),
  ])
