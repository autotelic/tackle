import { Schema } from "effect"

/**
 * What kind of entropy reversal a finding proposes.
 *
 * joggle is the entropy reverser (Armstrong): you press the frontier out, build
 * things, and then look at what you built and ask *can I rebuild this out of the
 * primitives I already have?* When the answer is no, the finding is one of three
 * things, and they are not interchangeable:
 *
 *   contract  a primitive already exists here. Delete the copy and use it.
 *   combine   the primitives exist; the combination was just never written.
 *   expand    neither -- the vocabulary has to grow: a name, a type, a boundary.
 *
 * `contract` is cleanup. `combine` is a refactor. `expand` is a design act, and
 * it is the scarcest and most valuable of the three -- in the framing this comes
 * from, it is "we are introducing a new pattern, and that is a change request."
 *
 * Absent means the rule is not about entropy at all: it checks the code against a
 * requirement (a cycle, a layering, a contract) rather than asking what the code
 * could be rebuilt from.
 */
export const Move = Schema.Literals(["contract", "combine", "expand"])

export type Move = typeof Move.Type

/**
 * The ratchet order.
 *
 * Contract first: the copies hide the primitives, so nothing else is legible
 * until they are gone. Then combine, because composing makes the primitives
 * explicit. Then expand, because a new primitive has to be built out of the ones
 * you can now see. This is "clean the leaves first" applied to the report.
 */
export const moveOrder: ReadonlyArray<Move> = ["contract", "combine", "expand"]

/** What each move means, in the reader's words. */
export const moveVocabulary = {
  contract: {
    label: "contract",
    blurb: "A primitive already exists here. Delete the copy and use it.",
  },
  combine: {
    label: "combine",
    blurb: "The primitives exist. Write the combination.",
  },
  expand: {
    label: "expand",
    blurb: "The vocabulary has to grow: a new name, a type, a boundary.",
  },
} satisfies Record<Move, { readonly label: string; readonly blurb: string }>
