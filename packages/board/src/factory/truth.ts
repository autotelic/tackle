import type { Activity } from "./activity.ts"
import type { DeskItem } from "./desk.ts"
import type { Phase } from "./store.ts"

/*
 * The truth a workstream's stores already hold, derived in one place.
 *
 * A record says a phase; it does not say whether a pass is running, how much is queued, or
 * which answer it is waiting on. Readers filled that gap with `ls receipts` and `grep events`,
 * and reached wrong conclusions — a busy pass read as idle, a parked workstream read as
 * merely old. Every field here comes from the receipt directory, the event log, the desk and
 * the phase; nothing is written, so there is no second state store to drift.
 *
 * `docs/workstream.md` §7 specifies a status *document* (schema, array of trimmed workstreams,
 * capStop, freshness). This is the smaller cut its consumers asked for: the fields added to the
 * per-record array `factory status --json` already prints, so a script that reads an array of
 * records keeps reading one.
 */

/** A pass the receipt says is running *and* whose process is alive. */
export interface RunningPass {
  readonly pass: number
  /** The receipt's process; null when it did not record one. */
  readonly pid: number | null
  readonly startedAt: string
}

export interface NextEvent {
  readonly id: string
  readonly kind: string
  readonly at: string
}

export interface OpenDesk {
  readonly id: string
  readonly title: string
  readonly choices: ReadonlyArray<string>
}

/**
 * Why a workstream cannot move.
 *
 * `awaiting-answer` needs both halves of the fact: the phase is `blocked` and an open desk item
 * names the question. A desk item raised while the workstream still works is a question, not a
 * hold, so it does not set this field.
 */
export interface HeldBy {
  readonly reason: "awaiting-answer" | "phase-blocked"
  readonly deskId: string | null
}

export interface LastReceipt {
  readonly pass: number
  /**
   * The receipt's own status, as written. `running` here beside a null `WorkstreamTruth.running`
   * is a writer that died mid-pass, not a pass in flight; the text says `interrupted`.
   */
  readonly status: "running" | "done" | "failed"
  readonly at: string
  /** The pass's captured checkpoint, or null when it ended before capturing one. */
  readonly checkpoint: string | null
}

export interface WorkstreamTruth {
  readonly running: RunningPass | null
  readonly pendingEvents: number
  readonly nextEvent: NextEvent | null
  readonly openDesk: OpenDesk | null
  readonly held: HeldBy | null
  readonly lastReceipt: LastReceipt | null
}

/**
 * The newest open desk item for a workstream.
 *
 * The newest, not the oldest: a workstream can hold a stale question and a live one, and the
 * live one is the answer that unblocks it. Ordering is `at`, then id, so two items sharing an
 * instant still resolve the same way on every read. Exported because the pass notification names
 * the same open item: one ordering, so the message and `factory status` cannot disagree.
 */
export const newestDesk = (desk: ReadonlyArray<DeskItem>): DeskItem | null =>
  [...desk]
    .sort(
      (left, right) =>
        Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id),
    )
    .at(-1) ?? null

/**
 * Whether this phase and this open item hold the workstream.
 *
 * `phase` is absent for a desk item whose workstream record was retired or never existed; an
 * unknown phase makes no hold claim.
 */
export const heldBy = (input: {
  readonly phase: Phase | undefined
  readonly item: DeskItem | null
}): HeldBy | null => {
  if (input.phase !== "blocked") return null
  return input.item === null
    ? { reason: "phase-blocked", deskId: null }
    : { reason: "awaiting-answer", deskId: input.item.id }
}

/**
 * Derive one workstream's truth from its activity and its open desk items.
 *
 * `activity.state === "working"` is the process-confirmed answer (`activityOf` asks the
 * receipt's pid), so `running` never repeats a stale `running` the way a raw receipt can.
 *
 * @param input - the workstream's activity and the open desk items for that workstream.
 * @returns the truth fields `factory status` serves beside the record.
 */
export const truthOf = (input: {
  readonly activity: Activity
  readonly desk: ReadonlyArray<DeskItem>
}): WorkstreamTruth => {
  const pass = input.activity.lastPass
  const openItem = newestDesk(input.desk)
  const openDesk: OpenDesk | null =
    openItem === null ? null : { id: openItem.id, title: openItem.title, choices: openItem.choices }
  const running: RunningPass | null =
    input.activity.state === "working" && pass !== null
      ? { pass: pass.pass, pid: pass.pid ?? null, startedAt: pass.at }
      : null
  const [next] = input.activity.pending
  return {
    running,
    pendingEvents: input.activity.pending.length,
    nextEvent: next === undefined ? null : { id: next.id, kind: next.kind, at: next.at },
    openDesk,
    held: heldBy({ phase: input.activity.phase, item: openItem }),
    lastReceipt:
      pass === null
        ? null
        : {
            pass: pass.pass,
            status: pass.status,
            at: pass.at,
            checkpoint: pass.checkpoint ?? null,
          },
  }
}
