import * as Domain from "@alchemy.run/domain"
import * as Layer from "effect/Layer"
import { Bench } from "./Bench.aggregate.ts"
import { BenchView, BenchViewLive } from "./BenchStatus.view.ts"

/** The bench control plane: create, pause, resume, and the status view. */
export class BenchModel extends Domain.Model("BenchModel", {
  aggregates: [Bench],
  views: [BenchView],
}) {}

/** Every view implementation the model needs. */
export const BenchHandlers = Layer.mergeAll(BenchViewLive)
