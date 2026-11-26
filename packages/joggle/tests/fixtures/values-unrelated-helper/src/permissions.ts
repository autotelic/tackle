export const ROLES = ["admin", "owner"] as const

export const allowed = (role: string): boolean => ROLES.includes(role as never)
