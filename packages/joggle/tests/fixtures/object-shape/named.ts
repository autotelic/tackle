export type Role = "admin" | "member" | "viewer"

/**
 * Three ways a literal gets a type without the rule seeing a declared field set:
 * `satisfies`, an annotation, and a cast. Each is a named shape, and the rule
 * keyed only on the literal's own field set.
 */
export const byRole = { admin: 0, member: 1, viewer: 2 } satisfies Record<Role, number>

export const direct: Record<Role, number> = { admin: 0, member: 1, viewer: 2 }

export const cast = { admin: 0, member: 1, viewer: 2 } as Record<Role, number>
