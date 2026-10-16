export type Count = number & { readonly _brand: "Count" }
export type PersonId = string & { readonly _brand: "PersonId" }

export interface PersonPayrollRecord {
  personId: PersonId
}

/** An indexed access to the same field: `PersonId`, written the long way. */
export interface IndexedPerson {
  personId: PersonPayrollRecord["personId"]
}

/**
 * An indexed access into a type the index cannot see -- a `Schema.Struct`-derived
 * type's fields are not in it. Unknown, not drift, so it is skipped.
 */
export interface ExternalPerson {
  personId: ExternalRecord["personId"]
}

export interface DirectPerson {
  personId: PersonId
}

/** A raw mirror: every field is the plain type on purpose. */
export interface UnparsedPlanterDay {
  treesPlanted: number
}

export interface PersonSummary {
  treesPlanted: Count
}

/** The genuine case: two words, two incompatible types. */
export interface GenuineA {
  totalScore: string
}

export interface GenuineB {
  totalScore: number
}

const ROLES_A = ["a", "b"] as const
const ROLES_B = ["c", "d"] as const

export type RoleA = (typeof ROLES_A)[number]
export type RoleB = (typeof ROLES_B)[number]

/** Both sides are computed, so text cannot compare them. */
export interface DerivedX {
  teamRole: RoleA
}

export interface DerivedY {
  teamRole: RoleB
}

/**
 * Nullability is a value, not strictness: a null can be stored in one and not
 * the other. `undefined` is optionality and stays compatible.
 */
export interface NullableA {
  ownerId: string | null
}

export interface NullableB {
  ownerId: string
}

export interface OptionalA {
  labelText?: string
}

export interface OptionalB {
  labelText: string | undefined
}

/**
 * A single-word field is a generic slot: `paths` here and `paths` there mean
 * different things and are not one concept that drifted. The policy says a name
 * needs two words before its type is compared, and this pair is the case that
 * pins it -- without the filter these ARE compared, which is what put eight
 * suppressions in joggle.config.json.
 */
export interface GenericA {
  paths: ReadonlyArray<string>
}

export interface GenericB {
  paths: string
}
