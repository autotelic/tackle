import * as Domain from "@alchemy.run/domain"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Bench } from "./Bench.aggregate.ts"
import { BenchStatus } from "./BenchStatus.ts"

/** The control-plane view: one row per bench, with the two columns a reader needs. */
export class BenchView extends Domain.View(
  "BenchView",
  {
    from: [Bench],
    key: Bench,
    state: Schema.Struct({
      status: BenchStatus,
      repo: Schema.NullOr(Schema.String),
      scope: Schema.NullOr(Schema.String),
    }),
    initial: { status: "archived", repo: null, scope: null },
    evolve: {
      BenchCreated: (_view, event) => ({
        status: "ready" as const,
        repo: event.repo,
        scope: event.scope,
      }),
      BenchPaused: (view) => ({ ...view, status: "paused" as const }),
      BenchResumed: (view) => ({ ...view, status: "ready" as const }),
    },
  },
  { description: "A bench's control-plane status, repo and scope." },
) {}

/** Anyone who can read the bench can read its summary. */
export const BenchViewLive = BenchView.toLayer(Effect.succeed(() => Effect.void))
