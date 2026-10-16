import { Schema } from "effect"

export const Point = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  label: Schema.optionalKey(Schema.String),
})

export const origin = { x: 0, y: 0 }
