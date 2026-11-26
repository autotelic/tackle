import { allowed } from "./permissions.ts"

// A second copy of the vocabulary, in a file that imports a HELPER -- not the
// vocabulary -- from the file that declares it. Importing something is not a
// home for this declaration.
export const Role = ["admin", "owner"] as const

export const visible = (role: string): boolean => allowed(role)
