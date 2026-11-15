import { Schema } from "effect"
import { Move } from "./moves.ts"

/*
 * The reversal, as a sequence of stages rather than separate scanners.
 *
 * `contract` is a copy of a primitive that already exists; `combine` is a
 * combination of primitives that was never written; `expand` is a concept the
 * vocabulary has no name for. The order is the thesis: nothing is legible until
 * the duplicates are gone, nothing can be composed until the primitives are
 * legible, and a new primitive has to be built out of the ones you can now see.
 *
 * A site walks the stages in order, and the first stage that answers is the one
 * finding it gets. That is what makes the report a decision path rather than
 * three rules disagreeing about the same declaration.
 */

/** What one earlier stage said about this site. It is part of the next state. */
export const StageOutcome = Schema.Struct({
  stage: Move,
  outcome: Schema.String,
})

export interface StageOutcome extends Schema.Schema.Type<typeof StageOutcome> {}

/**
 * The state every staged question carries: its own panel, the stage it is, and
 * what the earlier stages said.
 *
 * The earlier outcomes are in the state deliberately. A judgement asked at stage 3
 * with no knowledge of why stages 1 and 2 declined is a judgement about a
 * different question, and the answer cache keys on the state, so a site that
 * stopped at `combine` and a site that fell through to `expand` can never
 * share an answer.
 *
 * The panel schema is passed in rather than made generic at the call site: the
 * definition is built by the rule with its own concrete schema, so the state the
 * model validates is exactly the panel the rule sent.
 */
export const stagedInput = <Fields extends Schema.Struct.Fields>(panel: Schema.Struct<Fields>) =>
  Schema.Struct({
    stage: Move,
    earlier: Schema.Array(StageOutcome),
    panel,
  })
