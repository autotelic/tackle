import { Decision } from "effect/ai"

/* -------------------------------------------------------------------------- */

/** Shortens a type for a message. */
export const shortType = (value: string): string => value

export const note = "The notes are not decoration, and the funnel is the only thing that says otherwise."

export const surface = Decision.classify({
  instructions: "Pick one.",
  criteria: { meets: "A requirement the code does not meet." },
})

export const fragment = "]\` relevant to the question in \`query\`?"
