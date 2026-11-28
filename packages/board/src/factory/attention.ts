import { watch, type FSWatcher } from "node:fs"
import { activityOf } from "./activity.ts"
import { deskDir, listDesk, type DeskItem } from "./desk.ts"
import { factoryHome, listWorkstreams, workstreamDir, type Workstream } from "./store.ts"
import { truthOf, type WorkstreamTruth } from "./truth.ts"

/*
 * What a chief waits on, and the smallest way to wait for it.
 *
 * `factory status` is the truth and `notifyPass` is the push edge, but both assume a session
 * that is already awake. A chief that has to be told "the pass ended" by a prompt reminder is
 * polling from memory, which is what this module replaces: one read-only wait over the same
 * truth `factory status` prints, and no second store to keep in step with it.
 *
 * pi-durable has the durable shape — `runtime.sleepUntil` stores a deadline and `onWake` asks
 * the host to arm it — but it is the harness's API: a sleep lives in a conversation's journal,
 * opened by the Pi process that owns the conversation. The factory CLI is a plain Node process
 * started from a shell and handed a worktree; it has no harness, so there is no journal to
 * store a sleep in and no host to hand an alarm to. See
 * `docs/adr/0012-a-chief-waits-on-the-truth-document.md`.
 *
 * What that leaves is the local equivalent of `onWake`: the truth is files under
 * FACTORY_HOME, so a watcher on the workstream and desk directories wakes a sleeping wait the
 * moment a pass, a gate, a desk item or a review changes them. The backoff is the ceiling for
 * a change the watcher cannot see, not the only way to notice one.
 *
 * Waiting writes nothing. The record, the receipt, the event log and the desk are read; a
 * killed wait costs the chief nothing but the time it was asleep, because the next read of the
 * truth is the whole state.
 */

/** One record beside the truth derived from its stores: the row `factory status` serves. */
export interface Served {
  readonly record: Workstream
  readonly truth: WorkstreamTruth
}

/** Everything `factory status` reads: every record's truth, and the open desk items. */
export interface Status {
  readonly rows: ReadonlyArray<Served>
  readonly desk: ReadonlyArray<DeskItem>
}

/**
 * Read every record and the truth beside it.
 *
 * Exported because the wait and `factory status` must serve the same document: a second
 * reading path would let the thing a chief waits on and the thing it prints disagree.
 *
 * @param input - the factory home and the instant ages are measured from.
 * @returns the served rows and the open desk items.
 */
export const servedStatus = async (input?: {
  readonly home?: string | undefined
  readonly now?: number | undefined
}): Promise<Status> => {
  const records = await listWorkstreams({ home: input?.home })
  const desk = await listDesk({ home: input?.home })
  const now = input?.now ?? Date.now()
  const rows = await Promise.all(
    records.map(async (record) => ({
      record,
      truth: truthOf({
        activity: await activityOf({ record, now, home: input?.home }),
        desk: desk.filter((item) => item.workstream === record.id),
      }),
    })),
  )
  return { rows, desk }
}

/**
 * The attention a wait compares: everything a chief would act on, and nothing that merely ages.
 *
 * `ageMinutes` is deliberately absent. It changes on every read, so a signature that included
 * it would wake a wait that had nothing to wake for. `updatedAt` is present because it is the
 * one field that moves when a record is written for any reason — a notify target installed, a
 * gate installed, a phase changed — and every one of those is attention.
 *
 * @param status - the served truth.
 * @returns a stable string that changes exactly when attention does.
 */
export const attentionOf = (status: Status): string =>
  JSON.stringify({
    rows: status.rows.map(({ record, truth }) => [
      record.id,
      record.phase,
      record.updatedAt,
      record.head,
      record.checkpoint.sha,
      truth.running === null ? null : [truth.running.pass, truth.running.pid],
      truth.pendingEvents,
      truth.nextEvent === null ? null : truth.nextEvent.id,
      truth.openDesk === null ? null : truth.openDesk.id,
      truth.held === null ? null : [truth.held.reason, truth.held.deskId],
      truth.lastReceipt === null
        ? null
        : [truth.lastReceipt.pass, truth.lastReceipt.status, truth.lastReceipt.at],
    ]),
    // A desk item for a retired workstream has no row of its own; the item list is the only
    // place that question appears, so it is part of attention too.
    desk: status.desk.map((item) => [item.id, item.workstream, item.at]),
  })

/**
 * One minute, doubling to half an hour.
 *
 * The first interval is short because a pass usually ends within it; the ceiling is long
 * because an idle workstream is the normal case, and a chief that wakes every minute to find
 * nothing has turned a prompt reminder into a process reminder.
 */
export const waitIntervals = [60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000] as const

/** The longest a wait may sleep between reads. */
export const maxWaitIntervalMs = 1_800_000

export interface WaitInput {
  /** How long the whole wait may last. A wait is bounded; it is not a daemon. */
  readonly seconds: number
  readonly home?: string | undefined
  /** Milliseconds since epoch; injected so a test can advance time without sleeping. */
  readonly now?: (() => number) | undefined
  /** Resolve after ms or when the signal aborts; injected so a test can hold the clock. */
  readonly sleep?: ((ms: number, signal: AbortSignal) => Promise<void>) | undefined
  /** Register a change notification; returns the unsubscribe. Defaults to a filesystem watch. */
  readonly watch?: ((notify: () => void) => () => void) | undefined
}

export interface WaitResult {
  /** Whether attention changed. A false result is a bounded timeout, not a failure. */
  readonly changed: boolean
  readonly waitedMs: number
  /** How many times the truth was read, including the initial one. */
  readonly polls: number
  /** Every sleep this wait took, in order; the shape the backoff is judged by. */
  readonly intervals: ReadonlyArray<number>
  /** The truth as of the last read, so a caller prints what the wait actually saw. */
  readonly status: Status
}

const sleepFor = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

/**
 * Wake on any write under the two directories that carry attention.
 *
 * Recursive because a receipt and an event log live in the workstream's own files, beside the
 * record. A directory that is absent or unwatchable is not an error: the backoff still reads
 * the truth, and the only cost is latency.
 */
const watchHome = (home: string, notify: () => void): (() => void) => {
  const watchers: Array<FSWatcher> = []
  for (const directory of [workstreamDir(home), deskDir(home)]) {
    // SAFETY: watch throws on a missing directory and on a platform without recursive watch.
    try {
      watchers.push(watch(directory, { recursive: true }, () => notify()))
    } catch {
      // Nothing to watch is a slower wait, not a broken one.
    }
  }
  return () => {
    for (const watcher of watchers) watcher.close()
  }
}

/**
 * Sleep, wake on a change, and read the truth again until it moves or the wait ends.
 *
 * A change that arrives while the truth is being read is not lost: the wake sets a flag, and
 * the next sleep returns at once instead of waiting out an interval that predates it. The
 * watch is armed before the first read for the same reason.
 *
 * @param input - the bound, the factory home, and the clock the wait is judged by.
 * @returns whether attention changed, what was seen, and the backoff that was taken.
 */
export const waitForAttention = async (input: WaitInput): Promise<WaitResult> => {
  const home = input.home ?? factoryHome()
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? sleepFor
  const started = now()
  const deadline = started + input.seconds * 1000
  const intervals: Array<number> = []

  // A single wake slot: one aborts a pending sleep, and one that arrives between sleeps leaves
  // a flag so the next sleep is skipped. Neither is a queue, because a wake means "read again".
  let woken = false
  let wake: (() => void) | null = null
  const notify = (): void => {
    if (wake === null) woken = true
    else wake()
  }
  const stop = (input.watch ?? ((register) => watchHome(home, register)))(notify)

  try {
    let status = await servedStatus({ home, now: now() })
    let attention = attentionOf(status)
    let polls = 1
    for (;;) {
      const remaining = deadline - now()
      if (remaining <= 0)
        return { changed: false, waitedMs: now() - started, polls, intervals, status }
      const index = Math.min(intervals.length, waitIntervals.length - 1)
      const interval = Math.min(waitIntervals[index] ?? maxWaitIntervalMs, remaining)
      intervals.push(interval)
      if (woken) woken = false
      else
        await new Promise<void>((resolve) => {
          const controller = new AbortController()
          wake = () => {
            wake = null
            controller.abort()
          }
          const done = (): void => {
            wake = null
            resolve()
          }
          sleep(interval, controller.signal).then(done, done)
        })
      status = await servedStatus({ home, now: now() })
      const current = attentionOf(status)
      polls += 1
      if (current !== attention)
        return { changed: true, waitedMs: now() - started, polls, intervals, status }
      attention = current
    }
  } finally {
    stop()
  }
}
