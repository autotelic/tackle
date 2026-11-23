import { knex } from "knex"

/**
 * The escalation-checked writer: the guard the second writer in the pair skips.
 * This is the shape the rule hunts — the two files are independently defensible.
 */
export async function grant(db: typeof knex, roleId: string, permission: string, held: readonly string[]) {
  if (!held.includes(permission)) {
    throw new Error("a tenant may not grant what it does not hold")
  }
  return knex("authorization_rule").insert({ role_id: roleId, permission })
}

export async function revoke(db: typeof knex, roleId: string, permission: string) {
  return knex("authorization_rule").where({ role_id: roleId, permission }).del()
}
