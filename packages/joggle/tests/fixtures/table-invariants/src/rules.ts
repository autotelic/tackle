import { knex } from "knex"

/**
 * The unchecked writer: adds a rule to a role with no escalation guard.
 * Same table as grants.ts; the drift is the finding.
 */
export async function addRule(db: typeof knex, roleId: string, resourceId: string, permission: string) {
  const existing = await knex("authorization_rule").where({ role_id: roleId, permission }).first()
  if (existing) throw new Error("already exists")
  return knex("authorization_rule").insert({
    role_id: roleId,
    resource_id: resourceId,
    permission,
  })
}
