import knex from "knex"

/**
 * A record whose totals a job refreshes.
 *
 * The rule does not know that `audited` is a flag, that `supersededAt` is
 * absence by nature, or that this table records the past. Those are the
 * questions, and the fixture is the panel they are asked about.
 */
export interface PayrollRun {
  runId: string
  audited: boolean
  supersededAt?: string | null
  overrideReason?: string
  overrideBy?: string
}

/** Rewrites the stored total from current rows. */
export function refreshPayrollTotals(db = knex) {
  const rows = db("payroll_runs").select("run_id", "total")
  const total = rows.reduce((sum: number, row: { total: number }) => sum + row.total, 0)
  return db("payroll_runs").update({ total })
}

/** Reads the total as recorded. */
export function readPayrollTotals(db = knex) {
  return db("payroll_runs").select("total").where({ audited: true })
}

/** Detects that delivered does not equal planted plus destroyed. */
export function reconcileDelivered(db = knex) {
  const rows = db("deliveries").select("planted", "destroyed", "delivered")
  const residual = rows.reduce(
    (sum: number, row: { planted: number; destroyed: number; delivered: number }) =>
      sum + (row.delivered - (row.planted + row.destroyed)),
    0,
  )
  return { balanced: residual === 0, residual }
}

/** A read for a dashboard, with no stated staleness. */
export function summarizeDeliveries(db = knex) {
  return db("deliveries").select("planted", "destroyed", "delivered")
}
