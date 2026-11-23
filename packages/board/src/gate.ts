import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { decodeBaseline, decodeHarnessConfig, parseJson } from "@autotelic/protocol"
import type { Activity } from "./factory/activity.ts"

/*
 * The repo gate, as a projection of files that already exist.
 *
 * A gate belongs to the code a workstream works on, so it is read from the record's own
 * checkout: the committed baseline named by `gate.baseline` in `jig.config.json` (decoded
 * through protocol, because that package owns the format's one reader) and the jig counts
 * in the newest receipt, which `activityOf` already loads for the same document.
 *
 * Three facts are served, and two of them can be absent for honest reasons:
 *   - `baseline.identities` is null when there is no baseline or it does not decode.
 *     "no ledger" and "an empty ledger" are different claims, and a corrupt one must not
 *     become a confident zero;
 *   - `baseline.newestAccepted` is always null: the ledger is an unordered identity set
 *     with no timestamps, so the newest accepted identity is not in the file. The field is
 *     served anyway, with its reason, so a renderer can say "not recorded" instead of
 *     reporting a field nobody wrote;
 *   - `quality` names its own state, because a running or absent pass has not measured it.
 */

/** The committed baseline, read defensively: absent and unreadable are different facts. */
export interface BaselineGate {
  readonly state: "present" | "absent" | "unreadable"
  /** The ledger path, relative to the workstream's checkout. */
  readonly file: string
  /** Accepted identities in the ledger; null when there is no readable ledger. */
  readonly identities: number | null
  /** The ledger holds an unordered identity set with no timestamps; never derivable from it. */
  readonly newestAccepted: null
  readonly note: string
}

/** The jig counts from a receipt, or why there are none to serve. */
export type QualityGate =
  | {
      readonly state: "measured"
      readonly pass: number
      readonly at: string
      readonly available: boolean
      readonly errors: number
      readonly warnings: number
      readonly note: string
    }
  | { readonly state: "unmeasured"; readonly note: string }

/** What `/presence` says about the gate of one workstream's checkout. */
export interface Gate {
  readonly repo: string
  readonly path: string
  readonly observedAt: string
  readonly baseline: BaselineGate
  readonly quality: QualityGate
}

/** A workstream as presence serves it: the record, plus its checkout's gate. */
export type ServedWorkstream<A> = A & { readonly gate: Gate }

const defaultBaseline = ".jig-baseline.json"

/**
 * The baseline path the repository declares, defaulting when there is no usable config.
 *
 * @param path - the workstream's checkout.
 * @returns the baseline file, relative to that checkout.
 */
const baselineFile = async (path: string): Promise<string> => {
  const text = await readFile(join(path, "jig.config.json"), "utf8").catch(() => undefined)
  if (text === undefined) return defaultBaseline
  const config = decodeHarnessConfig(parseJson(text))
  return config?.gate.baseline ?? defaultBaseline
}

const baselineOf = async (input: {
  readonly path: string
  readonly file: string
}): Promise<BaselineGate> => {
  const text = await readFile(join(input.path, input.file), "utf8").catch(() => undefined)
  if (text === undefined)
    return {
      state: "absent",
      file: input.file,
      identities: null,
      newestAccepted: null,
      note: "no committed baseline; every finding is new",
    }
  const baseline = decodeBaseline(parseJson(text))
  if (baseline === undefined)
    return {
      state: "unreadable",
      file: input.file,
      identities: null,
      newestAccepted: null,
      note: "the baseline does not decode; read as unread, not empty",
    }
  return {
    state: "present",
    file: input.file,
    identities: baseline.identities.length,
    newestAccepted: null,
    note: "the baseline is an unordered identity set with no timestamps; newest accepted is not recorded",
  }
}

const qualityOf = (activity: Activity | undefined): QualityGate => {
  const pass = activity?.lastPass
  if (pass === null || pass === undefined)
    return { state: "unmeasured", note: "no pass has run for this workstream" }
  if (pass.quality === undefined)
    return {
      state: "unmeasured",
      note: "pass " + pass.pass + " has no jig counts (it is " + pass.status + ")",
    }
  return {
    state: "measured",
    pass: pass.pass,
    at: pass.at,
    available: pass.quality.after.available,
    errors: pass.quality.after.errors,
    warnings: pass.quality.after.warnings,
    note: pass.quality.after.note,
  }
}

/**
 * Attach each workstream's gate without reading one checkout's baseline twice.
 *
 * @param input - the records, their activities, and when the scan was taken.
 * @returns the records with `gate` added.
 */
export const workstreamsWithGates = async <
  A extends { readonly id: string; readonly repo: string; readonly path: string },
>(input: {
  readonly workstreams: ReadonlyArray<A>
  readonly activities: ReadonlyArray<Activity>
  readonly observedAt: string
}): Promise<ReadonlyArray<ServedWorkstream<A>>> => {
  const activityById = new Map(input.activities.map((activity) => [activity.workstream, activity]))
  const baselines = new Map<string, Promise<BaselineGate>>()
  return Promise.all(
    input.workstreams.map(async (record) => {
      let baseline = baselines.get(record.path)
      if (baseline === undefined) {
        baseline = baselineFile(record.path).then((file) => baselineOf({ path: record.path, file }))
        baselines.set(record.path, baseline)
      }
      return {
        ...record,
        gate: {
          repo: record.repo,
          path: record.path,
          observedAt: input.observedAt,
          baseline: await baseline,
          quality: qualityOf(activityById.get(record.id)),
        },
      }
    }),
  )
}
