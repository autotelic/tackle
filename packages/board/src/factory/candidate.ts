import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Data, Match } from "effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import type { Report } from "./report.ts"
import { factoryHome } from "./store.ts"

/*
 * The record between an observation and a desk item.
 *
 * Both faucets produce one of these: self-observation from a tooling report, experience from a
 * deploy window. The two facts a candidate must never merge are *whose work it is* and *who saw
 * it*: one observation can affect more than one workstream, and one piece of evidence can be
 * reported by more than one observer. So attribution is a list, and the fingerprint stays the
 * identity of the evidence — `report.fingerprint` when a report produced it. An observer in the
 * fingerprint would split one defect once per reporter and break the count that dedupe relies on.
 */

/** The two faucets: tackle reporting on its own tooling, and a product reporting on itself. */
export const CandidateKind = Schema.Literals(["self-observation", "experience"])
export type CandidateKind = typeof CandidateKind.Type

/**
 * One sighting of a candidate's evidence.
 *
 * A second observer of the same evidence appends here and never creates a second candidate;
 * a repeat by the same observer increments `count`, which is how a repeat stays a number
 * rather than a re-triage.
 */
export const Attribution = Schema.Struct({
  /** Whose work the evidence points at: the workstream that would fix it. */
  workstream: Schema.String,
  /** Who saw it: the workstream whose report, job or span produced the sighting. */
  observer: Schema.String,
  /** The ship or deploy this sighting is joined to, once the ship/deploy join has run. */
  sha: Schema.optional(Schema.String),
  firstAt: Schema.String,
  lastAt: Schema.String,
  /** Sightings of this evidence by this observer. */
  count: Schema.Finite,
})
export type Attribution = typeof Attribution.Type

/**
 * The proposal vocabulary, per kind.
 *
 * One global list would let `stable` describe a tooling report, which is a measurement nobody
 * took. Self-observation borrows the feedback ledger's endings (`docs/feedback.md`); experience
 * uses the four states of `docs/signals.md` §4, measured against the previous deploy.
 *
 * @param kind - the faucet the candidate came from.
 * @returns the states that kind may propose.
 */
export const proposalStates = (kind: CandidateKind): ReadonlyArray<string> =>
  kind === "self-observation"
    ? ["reported", "fixed", "unknown"]
    : ["regressed", "improved", "stable", "unknown"]

/** How much proof backs a proposal; only `evidence` may act without a human. */
export const Confidence = Schema.Literals(["evidence", "inference", "unknown"])
export type Confidence = typeof Confidence.Type

const CandidateFields = Schema.Struct({
  kind: CandidateKind,
  /** Evidence identity. Stable across observers, workstreams and repeats. */
  fingerprint: Schema.String,
  /** What the candidate is about, fixed for the life of the fingerprint. */
  subject: Schema.String,
  /** What a reader can open: report ids, sample refs, spans. */
  evidence: Schema.Array(Schema.String),
  proposal: Schema.Struct({ state: Schema.String, reason: Schema.String }),
  confidence: Confidence,
  attribution: Schema.Array(Attribution),
  /** First sighting. */
  at: Schema.String,
  /** Newest sighting. */
  updatedAt: Schema.String,
})

/**
 * The candidate record.
 *
 * `confidence` is a guard, not a label. A claim of `evidence` has to name the thing that proves
 * it — a report to open for a self-observation, a ship sha for an experience candidate — or the
 * record does not decode. Without this, "build the candidate first" would commit a body of
 * weaker evidence that the ship/deploy join could never upgrade.
 */
export const Candidate = CandidateFields.check(
  Schema.makeFilter((candidate) => {
    const issues: Array<{ readonly path: ReadonlyArray<string>; readonly issue: string }> = []
    if (candidate.attribution.length === 0)
      issues.push({
        path: ["attribution"],
        issue: "a candidate with no attribution is an observation, not work",
      })
    if (!proposalStates(candidate.kind).includes(candidate.proposal.state))
      issues.push({
        path: ["proposal", "state"],
        issue: candidate.kind + " has no state " + candidate.proposal.state,
      })
    if (candidate.confidence === "evidence") {
      const proven =
        candidate.kind === "self-observation"
          ? candidate.evidence.length > 0
          : candidate.attribution.some((entry) => (entry.sha ?? "") !== "")
      if (!proven)
        issues.push({
          path: candidate.kind === "self-observation" ? ["evidence"] : ["attribution"],
          issue:
            candidate.kind === "self-observation"
              ? "evidence with no report to open is inference"
              : "evidence with no ship sha is inference until the ship/deploy join fills it",
        })
    }
    return issues
  }),
)
export type Candidate = typeof Candidate.Type

/** A write the store refuses: a record that would not decode, or two faucets on one identity. */
export class CandidateRefused extends Data.TaggedError("CandidateRefused")<{
  readonly path: string
  readonly detail: string
}> {}

/**
 * One observer's sighting, as a faucet hands it to the store.
 *
 * `at` is the sighting's own instant, not the pass's: two observers of one report carry the
 * report's timestamp, so replaying the inbox cannot invent a newer sighting.
 */
export interface Sighting {
  readonly workstream: string
  readonly observer: string
  readonly sha?: string | undefined
  readonly at: string
}

/** One observation, before it is folded into a candidate record. */
export interface Observation {
  readonly kind: CandidateKind
  readonly fingerprint: string
  readonly subject: string
  readonly evidence: ReadonlyArray<string>
  readonly proposal: { readonly state: string; readonly reason: string }
  readonly confidence: Confidence
  readonly attribution: ReadonlyArray<Sighting>
}

/** The directory holding candidate records, outside every governed repo. */
export const candidateDir = (home: string = factoryHome()): string => join(home, "candidates")

/**
 * A candidate's id, derived from the fingerprint alone.
 *
 * The fingerprint is the key, and a report's fingerprint is not a legal file name, so the id is
 * its digest. Deriving it from anything else — the observer, the pass, the clock — would make a
 * repeat a new record.
 *
 * @param fingerprint - the evidence identity.
 * @returns a stable `cand-…` id.
 */
export const candidateIdOf = (fingerprint: string): string =>
  "cand-" + createHash("sha256").update(fingerprint).digest("hex").slice(0, 12)

/**
 * The file for one candidate, addressed by evidence identity rather than by observer.
 *
 * @param input - the fingerprint and optional home.
 * @returns the candidate path.
 */
export const candidateFile = (input: {
  readonly fingerprint: string
  readonly home?: string | undefined
}): string => join(candidateDir(input.home), candidateIdOf(input.fingerprint) + ".json")

/**
 * Read one candidate by its evidence identity; malformed is a miss, because a stale artifact
 * must degrade to silence rather than to a wrong attribution.
 *
 * @param input - the fingerprint and optional home.
 * @returns the candidate, or undefined.
 */
export const readCandidate = async (input: {
  readonly fingerprint: string
  readonly home?: string | undefined
}): Promise<Candidate | undefined> => {
  const text = await readFile(candidateFile(input), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const decoded = Schema.decodeResult(Schema.fromJsonString(Candidate))(text)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

/**
 * Every decodable candidate, in file order; one malformed file does not hide the rest.
 *
 * @param input - the optional home.
 * @returns the candidates.
 */
export const listCandidates = async (input?: { readonly home?: string | undefined }) => {
  const names = await readdir(candidateDir(input?.home)).catch(() => [])
  const candidates: Array<Candidate> = []
  for (const name of names.sort((left, right) => left.localeCompare(right))) {
    if (!name.endsWith(".json")) continue
    const text = await readFile(join(candidateDir(input?.home), name), "utf8").catch(
      () => undefined,
    )
    if (text === undefined) continue
    const decoded = Schema.decodeResult(Schema.fromJsonString(Candidate))(text)
    if (Result.isSuccess(decoded)) candidates.push(decoded.success)
  }
  return candidates
}

const latestOf = (values: ReadonlyArray<string>): string =>
  values
    .filter((value) => value !== "")
    .reduce(
      (latest, value) => (latest === "" || Date.parse(value) > Date.parse(latest) ? value : latest),
      "",
    )

/** Three ranks, so a merge compares claims instead of trusting whichever arrived last. */
const strengthOf = (confidence: Confidence): number =>
  Match.value(confidence).pipe(
    Match.when("evidence", () => 2),
    Match.when("inference", () => 1),
    Match.when("unknown", () => 0),
    Match.exhaustive,
  )

/** The strongest claim survives a merge: a later guess never demotes a proof. */
const strongest = (input: { readonly left: Confidence; readonly right: Confidence }): Confidence =>
  strengthOf(input.left) >= strengthOf(input.right) ? input.left : input.right

/**
 * Fold one observation into a candidate: the same fingerprint, one more attribution.
 *
 * The fingerprint is the observation's, always — a merge never renames evidence. Everything else
 * accumulates: attribution entries keyed by workstream, observer and sha; evidence unioned; the
 * confidence the stronger of the two; the proposal the newest, because it is the newest reading
 * of that evidence. The subject belongs to the first sighting, so one defect under two
 * descriptions keeps one name.
 *
 * @param input - the existing candidate, if one exists, and the new observation.
 * @returns the merged candidate, ready to be decoded before it is written.
 */
export const mergeObservation = (input: {
  readonly existing?: Candidate | undefined
  readonly observation: Observation
}): Candidate => {
  const sightedAt = input.observation.attribution.map((sighting) => sighting.at)
  const attribution = [...(input.existing?.attribution ?? [])]
  for (const sighting of input.observation.attribution) {
    const index = attribution.findIndex(
      (entry) =>
        entry.workstream === sighting.workstream &&
        entry.observer === sighting.observer &&
        (entry.sha ?? "") === (sighting.sha ?? ""),
    )
    const previous = attribution[index]
    if (previous === undefined) {
      attribution.push({
        workstream: sighting.workstream,
        observer: sighting.observer,
        sha: sighting.sha,
        firstAt: sighting.at,
        lastAt: sighting.at,
        count: 1,
      })
      continue
    }
    attribution[index] = {
      ...previous,
      firstAt:
        Date.parse(sighting.at) < Date.parse(previous.firstAt) ? sighting.at : previous.firstAt,
      lastAt: Date.parse(sighting.at) > Date.parse(previous.lastAt) ? sighting.at : previous.lastAt,
      count: previous.count + 1,
    }
  }
  return {
    kind: input.observation.kind,
    fingerprint: input.observation.fingerprint,
    subject: input.existing?.subject ?? input.observation.subject,
    evidence: [...new Set([...(input.existing?.evidence ?? []), ...input.observation.evidence])],
    proposal: input.observation.proposal,
    confidence:
      input.existing === undefined
        ? input.observation.confidence
        : strongest({
            left: input.existing.confidence,
            right: input.observation.confidence,
          }),
    attribution,
    at: input.existing?.at ?? latestOf(sightedAt),
    updatedAt: latestOf([input.existing?.updatedAt ?? "", ...sightedAt]),
  }
}

/**
 * Fold one observation into the candidate store and write it atomically.
 *
 * @param input - the observation and optional home.
 * @returns the candidate as written.
 */
export const recordCandidate = async (input: {
  readonly observation: Observation
  readonly home?: string | undefined
}): Promise<Candidate> => {
  const existing = await readCandidate({
    fingerprint: input.observation.fingerprint,
    home: input.home,
  })
  // One identity, two faucets: a report fingerprint that also names an experience candidate is a
  // collision the store cannot arbitrate, so it refuses rather than mixing two vocabularies.
  if (existing !== undefined && existing.kind !== input.observation.kind)
    throw new CandidateRefused({
      path: candidateFile({ fingerprint: input.observation.fingerprint, home: input.home }),
      detail: "kind collision: " + existing.kind + " and " + input.observation.kind,
    })
  const merged = mergeObservation({ existing, observation: input.observation })
  const path = candidateFile({ fingerprint: merged.fingerprint, home: input.home })
  const decoded = Schema.decodeResult(Candidate)(merged)
  if (Result.isFailure(decoded))
    throw new CandidateRefused({ path, detail: String(decoded.failure) })
  await mkdir(candidateDir(input.home), { recursive: true })
  const temporary = path + ".tmp"
  await writeFile(temporary, JSON.stringify(decoded.success, null, 2) + "\n")
  await rename(temporary, path)
  return decoded.success
}

/**
 * A tooling report becomes one self-observation candidate.
 *
 * The report is the evidence, so `report.fingerprint` is the candidate's identity and the report
 * id is what a reader opens. The two workstreams stay separate arguments because they are
 * separate facts: the work the evidence points at, and the workstream that saw it. A second
 * observer of the same report adds a second attribution entry and leaves the fingerprint alone.
 *
 * @param input - the report, whose work it points at, and who saw it.
 * @returns the observation the store folds in.
 */
export const candidateOfReport = (input: {
  readonly report: Report
  readonly workstream: string
  readonly observer: string
}): Observation => ({
  kind: "self-observation",
  fingerprint: input.report.fingerprint,
  subject: input.report.kind + ":" + input.report.command,
  evidence: [input.report.id],
  proposal: {
    state: "reported",
    reason:
      input.report.actual.split("\n").find((line) => line.trim() !== "") ?? input.report.actual,
  },
  confidence: "evidence",
  attribution: [{ workstream: input.workstream, observer: input.observer, at: input.report.at }],
})
