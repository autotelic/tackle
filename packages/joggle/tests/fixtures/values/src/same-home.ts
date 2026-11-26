import { ROLES } from "./auth.ts"

// The same vocabulary, declared again beside the file it imports it from.
// This one has a home and must not be reported.
export const Roles = ["admin", "owner"] as const

export const roles = ROLES
