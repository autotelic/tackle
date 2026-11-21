import * as Domain from "@alchemy.run/domain"
import { Story } from "@alchemy.run/domain/Story"
import { describe, expect, it } from "@effect/vitest"
import { Bench } from "../src/Bench/Bench.aggregate.ts"
import { BenchModel, BenchHandlers } from "../src/Bench/Bench.model.ts"
import { BenchView } from "../src/Bench/BenchStatus.view.ts"
import { BenchAlreadyExists, BenchCreated, CreateBench } from "../src/Bench/CreateBench.command.ts"
import { BenchNotRunning, BenchPaused, PauseBench } from "../src/Bench/PauseBench.command.ts"
import { BenchNotFound } from "../src/Bench/BenchNotFound.rejection.ts"
import { BenchNotPaused, BenchResumed, ResumeBench } from "../src/Bench/ResumeBench.command.ts"

const story = Story.make(BenchModel, { layer: BenchHandlers })
const bench = Bench.ref("acme-web-dev-1575")
const absent = Bench.ref("absent")
const T0 = 1_767_225_600_000 // the story clock starts here
const T1 = T0 + 60_000
const T2 = T1 + 60_000

describe("Bench", () => {
  it("the model is well defined", () => expect(Domain.verify(BenchModel)).toEqual([]))

  it.effect("creates once, pauses a ready bench, resumes a paused one", () =>
    story(
      Story.when(
        bench,
        new CreateBench({ benchId: bench.id, repo: "acme/web", scope: "dev-1575" }),
      ),
      Story.then(bench, new BenchCreated({ repo: "acme/web", scope: "dev-1575", at: T0 })),
      Story.view(BenchView, bench, {
        status: "ready",
        repo: "acme/web",
        scope: "dev-1575",
      }),

      // A place is not a handle: the second create is refused, not ignored.
      Story.when(
        bench,
        new CreateBench({ benchId: bench.id, repo: "acme/web", scope: "dev-1575" }),
      ),
      Story.rejected(new BenchAlreadyExists()),

      Story.clock(T1),
      Story.when(bench, new PauseBench({ benchId: bench.id })),
      Story.then(bench, new BenchPaused({ at: T1 })),
      Story.view(BenchView, bench, { status: "paused" }),

      Story.clock(T1),
      Story.when(bench, new PauseBench({ benchId: bench.id })),
      Story.rejected(new BenchNotRunning()),

      Story.clock(T2),
      Story.when(bench, new ResumeBench({ benchId: bench.id })),
      Story.then(bench, new BenchResumed({ at: T2 })),
      Story.view(BenchView, bench, { status: "ready" }),

      Story.clock(T2),
      Story.when(bench, new ResumeBench({ benchId: bench.id })),
      Story.rejected(new BenchNotPaused()),
    ),
  )

  it.effect("refuses to pause a bench that does not exist", () =>
    story(
      Story.when(absent, new PauseBench({ benchId: absent.id })),
      Story.rejected(new BenchNotFound()),
    ),
  )
})
