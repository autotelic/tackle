import * as Domain from "@alchemy.run/domain"
import { BenchModel } from "./Bench.model.ts"

/** The control-plane surface. Lease and move are separate models. */
export class BenchApi extends Domain.Api(
  "BenchApi",
  {
    model: BenchModel,
    commands: ["CreateBench", "PauseBench", "ResumeBench"],
    views: ["BenchView"],
  },
  { description: "Create, pause and resume a durable bench." },
) {}
