import knex from "knex"

export interface Row {
  readonly id: string
}

export function loadRows(options?: { projectId?: string; dateFrom?: string }): Promise<ReadonlyArray<Row>> {
  const query = knex("payroll_crew").select("*")
  if (options?.projectId !== undefined) query.where({ project_id: options.projectId })
  if (options?.dateFrom !== undefined) query.where("pay_date", ">=", options.dateFrom)
  return query
}
