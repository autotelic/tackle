import { ROLES } from "./base.ts"

// Declared again, but its home is imported: one home, not two.
export const Roles = ["admin", "owner"] as const

export const roles = ROLES
