import { PROTOCOL_VERSION } from "./version.ts"
import type { Diagnostic } from "./report.ts"

/*
 * The baseline: the findings a repository has already accepted, committed to the
 * repository so the ratchet is a property of the code and not of a cache.
 *
 * Two rules make a baseline useful:
 *   - keyed by identity, never by line, so a move is not a new finding;
 *   - a run fails on NEW identities, and the set only ever shrinks as findings are
 *     fixed — "warn repo-wide, error on touched files" is this file, not a second
 *     configuration.
 */

/** The accepted state of a repository. */
export interface Baseline {
  readonly protocolVersion: string
  readonly identities: ReadonlyArray<string>
}

/** A finding's stable name, falling back to engine+rule+file when it declared none. */
export const identityOf = (diagnostic: Diagnostic): string =>
  diagnostic.identity ?? `${diagnostic.engine}/${diagnostic.ruleId}:${diagnostic.location.file}`

/** The baseline for the findings in front of you. What `--update-baseline` writes. */
export const accept = (diagnostics: ReadonlyArray<Diagnostic>): Baseline => ({
  protocolVersion: PROTOCOL_VERSION,
  identities: [...new Set(diagnostics.map(identityOf))].sort(),
})

/** How a run compares to what was already accepted. */
export interface BaselineDiff {
  /** Findings not in the baseline. These are what a gate fails on. */
  readonly novel: ReadonlyArray<Diagnostic>
  /** Findings the baseline already accepted. */
  readonly known: ReadonlyArray<Diagnostic>
  /** Identities the baseline held that no longer fire. The ratchet moving down. */
  readonly stale: ReadonlyArray<string>
}

/** Compare findings against a baseline. */
export const diffBaseline = (
  baseline: Baseline,
  diagnostics: ReadonlyArray<Diagnostic>,
): BaselineDiff => {
  const accepted = new Set(baseline.identities)
  const novel: Array<Diagnostic> = []
  const known: Array<Diagnostic> = []
  const seen = new Set<string>()
  for (const diagnostic of diagnostics) {
    const identity = identityOf(diagnostic)
    seen.add(identity)
    if (accepted.has(identity)) known.push(diagnostic)
    else novel.push(diagnostic)
  }
  const stale = baseline.identities.filter((identity) => !seen.has(identity))
  return { novel, known, stale }
}

/**
 * One sentence per violation, for a gate to print.
 *
 * A baseline violation is a *new identity*, and the message names it so a reader can
 * tell "you introduced one finding" from "someone changed a rule's identity." An empty
 * list means the ratchet held.
 */
export const ratchetViolations = (diff: BaselineDiff): ReadonlyArray<string> => {
  const byKey = new Map<string, number>()
  for (const diagnostic of diff.novel) {
    const key = `${diagnostic.engine}/${diagnostic.ruleId}`
    byKey.set(key, (byKey.get(key) ?? 0) + 1)
  }
  return [...byKey.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(
      ([key, count]) => `${key}: ${count} new finding${count === 1 ? "" : "s"} not in the baseline`,
    )
}
