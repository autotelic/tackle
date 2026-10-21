import { isRecord, oneOf, str, strings } from "./decode.ts"

/*
 * The authored half of a part.
 *
 * A catalog can say what a part is made of; only a person can say what it is FOR,
 * when it is the wrong choice, what states it has, and whether it is still safe to
 * import. Those answers are stored beside the generated artifact, never inside it, so
 * regenerating a catalog cannot overwrite a sentence someone wrote.
 *
 * The shape is additive. A record with only `summary` is still a valid intent, which is
 * why the reader tests for "any answer at all" rather than for a required field: an empty
 * object is a file someone forgot to fill in, not an author saying "nothing applies".
 */

/** Where a part is in its life. Absent means the repo has not said. */
export type PartStatus = "stable" | "beta" | "experimental" | "deprecated"

export const PART_STATUSES: ReadonlyArray<PartStatus> = [
  "stable",
  "beta",
  "experimental",
  "deprecated",
]

/** The authored half of a menu entry, as stored in `intent/<key>.json`. */
export interface Intent {
  /** One line on what this part is for. */
  readonly summary?: string
  /** The situation the part is the right answer for. */
  readonly whenToUse?: string
  /** The situation it is the wrong answer for, and what to do instead. */
  readonly whenNotToUse?: string
  /** Named states the part handles: loading, empty, error, disabled. */
  readonly states?: ReadonlyArray<string>
  /** The lifecycle a consumer can rely on. */
  readonly status?: PartStatus
  /** Real call sites or canonical snippets that show the approved use. */
  readonly examples?: ReadonlyArray<string>
  /** What to reach for instead, when a near-duplicate or a retirement exists. */
  readonly useInstead?: ReadonlyArray<string>
}

/**
 * Read one intent record, or `undefined` when it says nothing usable.
 *
 * Every field is optional, and a malformed optional field degrades to absent rather
 * than taking the whole record with it. The one thing that is not tolerated is a record
 * that answers nothing: treating that as intent would hide it from the `_(undocumented)_`
 * flag, which is the only place the absence is visible.
 */
export const decodeIntent = (value: unknown): Intent | undefined => {
  if (!isRecord(value)) return undefined
  const summary = str(value.summary)
  const whenToUse = str(value.whenToUse)
  const whenNotToUse = str(value.whenNotToUse)
  const states = strings(value.states)
  const status = oneOf(value.status, PART_STATUSES)
  const examples = strings(value.examples)
  const useInstead = strings(value.useInstead)
  if (
    summary === undefined &&
    whenToUse === undefined &&
    whenNotToUse === undefined &&
    states === undefined &&
    status === undefined &&
    examples === undefined &&
    useInstead === undefined
  ) {
    return undefined
  }
  return {
    ...(summary === undefined ? {} : { summary }),
    ...(whenToUse === undefined ? {} : { whenToUse }),
    ...(whenNotToUse === undefined ? {} : { whenNotToUse }),
    ...(states === undefined ? {} : { states }),
    ...(status === undefined ? {} : { status }),
    ...(examples === undefined ? {} : { examples }),
    ...(useInstead === undefined ? {} : { useInstead }),
  }
}

/** Whether an intent record carries anything a reader can act on. */
export const hasIntent = (intent: Intent | undefined) =>
  intent !== undefined &&
  (intent.summary !== undefined ||
    intent.whenToUse !== undefined ||
    intent.whenNotToUse !== undefined ||
    (intent.states?.length ?? 0) > 0 ||
    intent.status !== undefined ||
    (intent.examples?.length ?? 0) > 0 ||
    (intent.useInstead?.length ?? 0) > 0)
