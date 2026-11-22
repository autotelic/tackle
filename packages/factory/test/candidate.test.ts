import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { expect, test } from "vitest"
import {
  Candidate,
  CandidateRefused,
  candidateIdOf,
  candidateOfReport,
  listCandidates,
  mergeObservation,
  readCandidate,
  recordCandidate,
  type Observation,
} from "../src/candidate.ts"
import type { Report } from "../src/report.ts"

/* oxlint-disable plumb/prefer-property-tests -- one evidence identity, two observers. */

const report: Report = {
  id: "report-permissions-1862-1795303302409",
  workstream: "permissions-1862",
  kind: "conformance",
  at: "2026-11-22T09:20:02.409Z",
  command: "jig check",
  expected: "0 error",
  actual: "packages/factory/src/adopt.ts:41 require-jsdoc-on-exported\nsecond line",
  output: "",
  blocked: false,
  fingerprint: "conformance:jig check:bf49d72626a9",
}

const observation = (overrides: Partial<Observation> = {}): Observation => ({
  ...candidateOfReport({
    report,
    workstream: "tackle-factory",
    observer: "permissions-1862",
  }),
  ...overrides,
})

test("a second observer of one report adds an attribution, never a candidate", () => {
  const first = mergeObservation({ observation: observation() })
  const second = mergeObservation({
    existing: first,
    observation: candidateOfReport({
      report,
      workstream: "tackle-factory",
      observer: "enterprise-1854",
    }),
  })
  expect(second.fingerprint).toBe(report.fingerprint)
  expect(second.attribution.length).toBe(2)
  expect(second.attribution.map((entry) => entry.observer)).toEqual([
    "permissions-1862",
    "enterprise-1854",
  ])
  expect(candidateIdOf(second.fingerprint)).toBe(candidateIdOf(first.fingerprint))
  expect(Result.isSuccess(Schema.decodeResult(Candidate)(second))).toBe(true)
})

test("one observation can affect more than one workstream", () => {
  const merged = mergeObservation({
    observation: observation({
      attribution: [
        {
          workstream: "tackle-factory",
          observer: "permissions-1862",
          at: report.at,
        },
        {
          workstream: "enterprise-1854",
          observer: "permissions-1862",
          at: report.at,
        },
      ],
    }),
  })
  expect(merged.attribution.map((entry) => entry.workstream)).toEqual([
    "tackle-factory",
    "enterprise-1854",
  ])
  expect(merged.attribution.every((entry) => entry.count === 1)).toBe(true)
})

test("a repeat counts, and a new sha is a new sighting", () => {
  const once = mergeObservation({ observation: observation() })
  const twice = mergeObservation({
    existing: once,
    observation: observation({
      attribution: [
        {
          workstream: "tackle-factory",
          observer: "permissions-1862",
          at: "2026-11-22T12:41:10.000Z",
        },
      ],
    }),
  })
  expect(twice.attribution.length).toBe(1)
  expect(twice.attribution[0]?.count).toBe(2)
  expect(twice.attribution[0]?.firstAt).toBe(report.at)
  expect(twice.attribution[0]?.lastAt).toBe("2026-11-22T12:41:10.000Z")
  expect(twice.at).toBe(report.at)
  expect(twice.updatedAt).toBe("2026-11-22T12:41:10.000Z")

  const shipped = mergeObservation({
    existing: twice,
    observation: observation({
      attribution: [
        {
          workstream: "tackle-factory",
          observer: "permissions-1862",
          sha: "7c9e1f0",
          at: "2026-11-22T13:02:00.000Z",
        },
      ],
    }),
  })
  expect(shipped.attribution.length).toBe(2)
  expect(shipped.fingerprint).toBe(report.fingerprint)
})

test("evidence must name what proves it, and the state must belong to its kind", () => {
  const candidate = mergeObservation({ observation: observation() })
  const decodes = Schema.decodeResult(Candidate)
  expect(Result.isFailure(decodes({ ...candidate, evidence: [] }))).toBe(true)
  expect(
    Result.isFailure(decodes({ ...candidate, proposal: { state: "stable", reason: "guessed" } })),
  ).toBe(true)
  expect(Result.isFailure(decodes({ ...candidate, attribution: [] }))).toBe(true)
  expect(Result.isSuccess(decodes({ ...candidate, confidence: "inference", evidence: [] }))).toBe(
    true,
  )

  // An experience candidate's proof is the ship sha, not a report id.
  const experience: Candidate = {
    ...candidate,
    kind: "experience",
    evidence: [],
    proposal: { state: "regressed", reason: "p95 3.9x the previous deploy" },
  }
  expect(Result.isFailure(decodes(experience))).toBe(true)
  expect(
    Result.isSuccess(
      decodes({
        ...experience,
        attribution: [
          {
            workstream: "perms-1862",
            observer: "shop",
            sha: "7c9e1f0",
            firstAt: report.at,
            lastAt: report.at,
            count: 1,
          },
        ],
      }),
    ),
  ).toBe(true)
})

test("the recorded fixture is one candidate with two sightings", () => {
  const text = readFileSync(
    fileURLToPath(new URL("./fixtures/candidate/self-observation.json", import.meta.url)),
    "utf8",
  )
  const decoded = Schema.decodeResult(Schema.fromJsonString(Candidate))(text)
  expect(Result.isSuccess(decoded)).toBe(true)
  if (Result.isFailure(decoded)) return
  expect(decoded.success.fingerprint).toBe("conformance:jig check:bf49d72626a9")
  expect(decoded.success.attribution.map((entry) => entry.observer)).toEqual([
    "permissions-1862",
    "enterprise-1854",
  ])
  expect(decoded.success.attribution[0]?.count).toBe(2)
})

test("the store keeps one file per fingerprint across observers", async () => {
  const home = mkdtempSync(join(tmpdir(), "factory-candidate-"))
  try {
    await recordCandidate({ observation: observation(), home })
    await recordCandidate({
      observation: candidateOfReport({
        report,
        workstream: "tackle-factory",
        observer: "enterprise-1854",
      }),
      home,
    })
    const stored = await readCandidate({ fingerprint: report.fingerprint, home })
    expect(stored?.attribution.length).toBe(2)
    expect(stored?.fingerprint).toBe(report.fingerprint)
    expect((await listCandidates({ home })).length).toBe(1)
    expect(await readCandidate({ fingerprint: "conformance:jig check:none", home })).toBeUndefined()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("one identity cannot carry two kinds", async () => {
  const home = mkdtempSync(join(tmpdir(), "factory-candidate-kind-"))
  try {
    await recordCandidate({ observation: observation(), home })
    const wrong = observation({ kind: "experience", proposal: { state: "unknown", reason: "" } })
    const refusal = await recordCandidate({ observation: wrong, home }).catch(
      (error: CandidateRefused) => error,
    )
    expect(refusal).toMatchObject({
      _tag: "CandidateRefused",
      detail: expect.stringContaining("kind collision"),
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
