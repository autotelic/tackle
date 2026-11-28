/**
 * The miss ledger, and the one renderer that reads it.
 *
 * A miss is a question the stand-in refused to answer. It is not a failed answer and
 * it is not a zero: a probability of zero says the head looked and said no, while a
 * miss says no head existed. Keeping the two apart is the whole point of this package,
 * so the ledger records the reason and the question identity, never a fabricated value.
 */

/** Why a question had no answer. */
export type MissReason = "no-head" | "head-failed"

/** The identity of a question: its kind and a hash of its encoded definition. */
export interface Question {
  readonly tag: string
  readonly hash: string
}

/** One refusal, before the ledger aggregates repeats. */
export interface Miss {
  readonly question: Question
  readonly kind: string
  readonly labelSet: ReadonlyArray<string>
  readonly reason: MissReason
}

/** One row of the ledger: a question hash and how often it was missed. */
export interface MissRecord {
  readonly questionHash: string
  readonly kind: string
  readonly labelSet: ReadonlyArray<string>
  readonly reason: MissReason
  readonly count: number
  readonly firstSeen: number
  readonly lastSeen: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")

const isMissReason = (value: unknown): value is MissReason =>
  value === "no-head" || value === "head-failed"

const isMissRecord = (value: unknown): value is MissRecord =>
  isRecord(value) &&
  typeof value["questionHash"] === "string" &&
  typeof value["kind"] === "string" &&
  isStringArray(value["labelSet"]) &&
  isMissReason(value["reason"]) &&
  typeof value["count"] === "number" &&
  typeof value["firstSeen"] === "number" &&
  typeof value["lastSeen"] === "number"

const labelText = (labels: ReadonlyArray<string>): string =>
  labels.length === 0 ? "[]" : "['" + labels.join("','") + "']"

const line = (record: MissRecord): string =>
  [
    "miss",
    record.kind,
    String(record.count) + (record.count === 1 ? " question" : " questions"),
    record.reason,
    record.questionHash,
    labelText(record.labelSet),
  ].join("  ")

/**
 * Deterministic order: most-missed first, then hash.
 *
 * The clock is deliberately not part of the order or the line. A ledger rendered twice
 * without a new miss must be byte-identical, or a diff of two runs would report time
 * passing as a change in the questions.
 */
const ordered = (records: ReadonlyArray<MissRecord>): ReadonlyArray<MissRecord> =>
  [...records].sort(
    (left, right) =>
      right.count - left.count || left.questionHash.localeCompare(right.questionHash),
  )

/** Render records as one line per miss. Empty means no miss was recorded. */
export const renderMisses = (records: ReadonlyArray<MissRecord>): string =>
  ordered(records).map(line).join("\n")

/**
 * An append-only, hash-keyed record of the questions this stand-in could not answer.
 *
 * Recording is monotonic: a miss either creates a row or raises its count. There is no
 * delete and no rewrite, so a ledger from a long run can be trusted as a history rather
 * than as a cache that happened to be current.
 */
export class MissLedger {
  private readonly rows = new Map<string, MissRecord>()
  private readonly clock: () => number

  constructor(clock: () => number = Date.now) {
    this.clock = clock
  }

  /** Record one miss. The same question increments its row rather than adding another. */
  record(miss: Miss): void {
    const at = this.clock()
    const key = miss.question.hash
    const existing = this.rows.get(key)
    if (existing === undefined) {
      this.rows.set(key, {
        questionHash: key,
        kind: miss.kind,
        labelSet: [...miss.labelSet],
        reason: miss.reason,
        count: 1,
        firstSeen: at,
        lastSeen: at,
      })
      return
    }
    this.rows.set(key, {
      ...existing,
      count: existing.count + 1,
      lastSeen: at,
    })
  }

  /** Every row, in render order. A copy, so a caller cannot mutate the ledger. */
  snapshot(): ReadonlyArray<MissRecord> {
    return ordered([...this.rows.values()])
  }

  /** One line per miss, sorted by count then hash. */
  render(): string {
    return renderMisses(this.snapshot())
  }

  /** How many questions were missed, counting repeats. */
  total(): number {
    let total = 0
    for (const row of this.rows.values()) total += row.count
    return total
  }

  /** The persisted form: a document, so a later reader can tell a ledger from a bare array. */
  encode(): string {
    return JSON.stringify({ misses: this.snapshot() }, null, 2) + "\n"
  }

  /**
   * Read a ledger defensively.
   *
   * A malformed file is an empty ledger, never a crash: the CLI has to stay usable when
   * the artifact it was pointed at is stale or hand-edited.
   */
  static decode(text: string): MissLedger {
    let document: unknown
    try {
      document = JSON.parse(text)
    } catch {
      return new MissLedger()
    }
    const candidates = Array.isArray(document)
      ? document
      : isRecord(document)
        ? Array.isArray(document["misses"])
          ? document["misses"]
          : Array.isArray(document["records"])
            ? document["records"]
            : []
        : []
    const ledger = new MissLedger()
    for (const candidate of candidates) {
      if (isMissRecord(candidate)) ledger.rows.set(candidate.questionHash, candidate)
    }
    return ledger
  }
}

/** The exported function form, for a caller holding a ledger. */
export const snapshot = (ledger: MissLedger): ReadonlyArray<MissRecord> => ledger.snapshot()

/** The exported function form, for a caller that already has records. */
export const render = (records: ReadonlyArray<MissRecord>): string => renderMisses(records)
