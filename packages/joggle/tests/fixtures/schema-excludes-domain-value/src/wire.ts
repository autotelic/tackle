import { Schema } from "effect"

export const PlanterModelResponse = Schema.Struct({
  thetaStandardError: Schema.Finite,
  days: Schema.Number,
})
