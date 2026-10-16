import { Schema } from "effect"

const uuid = Schema.String

/** The row contract, with each field naming the column it reads. */
export const PayrollCrewRowSchema = Schema.Struct({
  // The migration leaves this nullable, so a required field here decodes a null
  // the database will hand it one day.
  personId: uuid.annotate({ sourceColumn: "payroll_crew.shakti_user_id" }),
  // Agrees: required in both.
  projectId: uuid.annotate({ sourceColumn: "payroll_crew.project_id" }),
  // Agrees: nullable in both.
  maybePersonId: Schema.NullOr(uuid).annotate({ sourceColumn: "payroll_crew.shakti_user_id" }),
  // Not annotated, so there is nothing to compare -- the honest default.
  label: Schema.String,
})
