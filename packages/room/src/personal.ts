import { Result, Schema } from "effect"

/*
 * The personal review queue.
 *
 * The room is project-scoped: one repo, one stage, one label. A person's review requests are
 * none of those. Someone marks a pull request ready for review and asks for *you* by name, in
 * any repository, and the only durable record of that is GitHub's own search:
 * `review-requested:@me` returns what is outstanding and drops a pull request once a review is
 * submitted.
 *
 * So the queue is a watermark over that search, not a work list of its own. It records when a
 * worker was last raised for a pull request and which worker that was; "done" is never recorded,
 * because "done" is the search no longer returning the row. A session that dies, a machine that
 * sleeps, or an extension that was never loaded all converge on the same reconciliation: ask
 * GitHub what is still outstanding, and raise a worker for anything whose worker is gone.
 */

/** One outstanding review request, as GitHub reports it. */
export interface ReviewTarget {
  /** `owner/name`, so the queue can span repositories without a room config. */
  readonly repo: string
  readonly pr: number
  readonly title: string
  readonly url: string
}

/** What the queue remembers about one pull request. `raisedAt` is the only clock that matters. */
export const Raised = Schema.Struct({
  raisedAt: Schema.Finite,
  /** The Rex session or window id of the worker raised for it, when one was. */
  worker: Schema.optionalKey(Schema.String),
  /** The head the worker was raised for: a new head is a new review, even in the same session. */
  sha: Schema.optionalKey(Schema.String),
})

/** One pull request's watermark. */
export type Raised = typeof Raised.Type

/** The whole queue, keyed by `repo#pr`. */
export const PersonalQueue = Schema.Struct({
  version: Schema.Literal(1),
  prs: Schema.Record(Schema.String, Raised),
})

/** The whole queue. */
export type PersonalQueue = typeof PersonalQueue.Type

export const emptyQueue: PersonalQueue = { version: 1, prs: {} }

/** The key a pull request is remembered by. */
export const keyOf = (target: { readonly repo: string; readonly pr: number }): string =>
  `${target.repo}#${String(target.pr)}`

/** The worker name for a target: stable across runs, so a reconcile can adopt what is running. */
export const workerNameOf = (target: { readonly repo: string; readonly pr: number }): string => {
  const name = target.repo.split("/")[1] ?? target.repo
  return `review-${name}-${String(target.pr)}`
}

/**
 * Read the queue, or the empty one. A malformed file is silence, never a false finding: the
 * next reconcile raises everything still outstanding, which is the same state as a cold start.
 *
 * @param text - The file's contents.
 * @returns The queue.
 */
export const decodeQueue = (text: string): PersonalQueue =>
  Result.getOrElse(
    Schema.decodeResult(Schema.fromJsonString(PersonalQueue))(text),
    (): PersonalQueue => emptyQueue,
  )

/** Encode the queue in the one shape the writer emits. */
export const encodeQueue = (queue: PersonalQueue): string => `${JSON.stringify(queue, null, 2)}\n`

/** What the reconcile decided for one pull request. */
export interface Decision {
  readonly target: ReviewTarget
  readonly kind: "raise" | "skip"
  /** Why, in the words a person needs to trust the line. */
  readonly reason: string
  /** The worker already raised for it, when there is one and it is still alive. */
  readonly worker?: string | undefined
}

/** The reconcile's answer: what to raise now, and the queue after it. */
export interface PersonalPlan {
  readonly decisions: ReadonlyArray<Decision>
  readonly queue: PersonalQueue
}

/**
 * Reconcile the search against the queue.
 *
 * Raise when the pull request is new, or when the worker that was raised for it is gone
 * (`alive` holds the worker ids Rex reports now, `aliveByName` the labels of the same). A
 * running worker whose name matches is *adopted* rather than duplicated: the first reconcile
 * after a restart must not launch a second reviewer for work that survived.
 *
 * Pruning is the other half: a key the search no longer returns has been reviewed or withdrawn,
 * and keeping it would let a stale "raised" entry mask the next request on the same PR.
 *
 * @param input - The search rows, the stored queue, the instant, the live workers, the cooldown.
 * @returns The decisions and the queue to store.
 */
export const planReviews = (input: {
  readonly targets: ReadonlyArray<ReviewTarget>
  readonly queue: PersonalQueue
  readonly now: number
  readonly alive: ReadonlySet<string>
  readonly aliveByName: ReadonlyMap<string, string>
  readonly cooldownMs: number
  /** Raise everything again, ignoring the cooldown and the live-worker skip. */
  readonly force?: boolean | undefined
}): PersonalPlan => {
  const decisions: Array<Decision> = []
  const prs: Record<string, Raised> = {}
  for (const target of input.targets) {
    const key = keyOf(target)
    const previous = input.queue.prs[key]
    const adopted = input.aliveByName.get(workerNameOf(target))
    if (input.force === true) {
      decisions.push({ target, kind: "raise", reason: "forced", worker: previous?.worker })
      prs[key] = { raisedAt: input.now }
      continue
    }
    // A worker with the right name is already on it, whether or not the queue remembers it.
    if (adopted !== undefined) {
      decisions.push({
        target,
        kind: "skip",
        reason: `worker ${adopted} is still running`,
        worker: adopted,
      })
      prs[key] =
        previous?.sha === undefined
          ? { raisedAt: previous?.raisedAt ?? input.now, worker: adopted }
          : { raisedAt: previous.raisedAt, worker: adopted, sha: previous.sha }
      continue
    }
    if (previous === undefined) {
      decisions.push({ target, kind: "raise", reason: "marked for review" })
      prs[key] = { raisedAt: input.now }
      continue
    }
    const worker = previous.worker
    const live = worker !== undefined && input.alive.has(worker)
    if (live) {
      decisions.push({
        target,
        kind: "skip",
        reason: `worker ${worker} is still running`,
        worker,
      })
      prs[key] = previous
      continue
    }
    // No worker, or a worker Rex no longer lists: the review did not happen.
    const waited = input.now - previous.raisedAt
    if (waited < input.cooldownMs) {
      decisions.push({
        target,
        kind: "skip",
        reason: `raised ${Math.round(waited / 60_000)}m ago; waiting for the worker to finish`,
      })
      prs[key] = previous
      continue
    }
    decisions.push({
      target,
      kind: "raise",
      reason: worker === undefined ? "raised before, no worker recorded" : "the worker is gone",
    })
    prs[key] = { raisedAt: input.now }
  }
  return { decisions, queue: { version: 1, prs } }
}

/** Record the worker raised for one pull request, so the next reconcile can see it is alive. */
export const recordWorker = (input: {
  readonly queue: PersonalQueue
  readonly target: ReviewTarget
  readonly worker: string
  readonly sha: string
  readonly now: number
}): PersonalQueue => {
  const prs: Record<string, Raised> = { ...input.queue.prs }
  prs[keyOf(input.target)] = { raisedAt: input.now, worker: input.worker, sha: input.sha }
  return { version: 1, prs }
}
