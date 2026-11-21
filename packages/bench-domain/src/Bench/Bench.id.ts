import * as Schema from "effect/Schema"

/** One durable place, addressed by the same name across hosts. */
export const BenchId = Schema.String.pipe(Schema.brand("BenchId"))
export type BenchId = typeof BenchId.Type
