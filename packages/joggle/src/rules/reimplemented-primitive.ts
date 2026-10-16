import { Effect, Schema } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { lineAt } from "../cascade.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import {
  inScope,
  marginOfAnswer,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import { stripFile } from "./call-pattern.ts"
import type { Diagnostic, Drop, Edit } from "../schema.ts"
import { lineStarts, type Unit, type Workspace } from "../workspace.ts"

const RULE_ID = "joggle/reimplemented-primitive"

/**
 * A function that inlines exactly what an existing declaration already does.
 *
 * Two halves, and the split is the point of `docs/two-regimes.md`.
 *
 * The deterministic half is GENERATION: which pairs are even candidates. That is
 * the resolved call graph -- a function whose whole body is a run of calls has a
 * key, and two functions with the same key are a pair worth judging. The key is
 * the resolved callees, coarse on purpose -- what each call READS is evidence the
 * question sees, not part of the key -- so it is a high-recall filter and not the
 * verdict.
 *
 * The judged half is the VERDICT: are these two the same operation? That is the
 * question `same_behavior` used to ask and answered badly, because it was asked
 * over text with no call sites in the state. Here the state IS the call graph --
 * both bodies, their callees resolved to declarations, and the leaf inputs they
 * read -- which is the evidence the old question was missing.
 *
 * A run with no model key reports the pair unverified rather than deciding it,
 * which is what a high-recall candidate deserves.
 */
export const reimplementedPrimitive: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "A function that inlines exactly what an existing declaration already does.",
  judged: true,
  move: "contract",
  onUnavailable: "report",
  operations: ["replace"],
  messages: messages({
    inlined_helper:
      "{{name}} inlines what `{{helper}}` already does: {{count}} call(s) in the same order.",
    inlined_helper_help:
      "Call `{{helper}}` in {{helperFile}} instead of repeating its body. The calls are {{calls}}.{{unverified}}",
  }),
  plan: Effect.fn("joggle/reimplemented-primitive")(function* (
    workspace: Workspace,
    scope: Scope,
  ) {
    const report = reporter(reimplementedPrimitive, locator(workspace))
    const { minCalls, maxPairs } = policy.reimplementedPrimitive

    const fileOf = new Map(workspace.files.map((file) => [file.path, file]))

    // A call is its callee AND its arguments. Keying on callee names alone
    // reported `companyYearTotalsJson` as a re-implementation of
    // `crewSummaryToJson` because both read `Number -> Number -> Number ->
    // String`; the arguments are what told the two apart.
    const signatureOf = (
      unit: Unit,
    ):
      | {
          readonly keys: ReadonlyArray<string>
          readonly sites: ReadonlyArray<{ readonly start: number; readonly end: number }>
          readonly text: string
        }
      | undefined => {
      const file = fileOf.get(unit.file)
      if (file === undefined) return undefined
      const sites = file.facts.callSites.filter(
        (site) => site.start >= unit.start && site.end <= unit.end,
      )
      // The pairing only holds when every call has its span.
      if (sites.length !== unit.calls.length) return undefined
      // The resolved callee, which is a fact. What each call READS is evidence --
      // `callGraphEvidence` carries it -- not part of the key: collapsing it here
      // decided whether two calls had "the same inputs", which is the question
      // (docs/rule-coupling.md).
      const keys = sites.map((site, index) => {
        void site
        return unit.calls[index] ?? ""
      })
      return { keys, sites, text: file.text }
    }

    // A declaration whose WHOLE body is its call sequence. That is the thing that
    // can be called instead of inlined; a longer declaration is not a primitive.
    const bySequence = new Map<string, Unit>()
    for (const unit of workspace.units) {
      if (unit.kind !== "function" || unit.calls.length < minCalls) continue
      const signature = signatureOf(unit)
      if (signature === undefined) continue
      const key = signature.keys.join("\u0000")
      if (!bySequence.has(key)) bySequence.set(key, unit)
    }
    if (bySequence.size === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no function's whole body is a run of " + minCalls + " or more resolved calls",
          ]),
      }
    }

    // Every pair: a run of calls in one declaration matching the whole body of
    // another. This is candidate generation and nothing more.
    const pairs: Array<{
      readonly unit: Unit
      readonly helper: Unit
      readonly start: number
      readonly length: number
    }> = []
    for (const unit of workspace.units) {
      if (unit.kind !== "function" || unit.calls.length < minCalls) continue
      if (!inScope(scope, unit.file)) continue
      const signature = signatureOf(unit)
      if (signature === undefined) continue
      for (let start = 0; start + minCalls <= unit.calls.length; start += 1) {
        const length = unit.calls.length - start
        const helper = bySequence.get(signature.keys.slice(start, start + length).join("\u0000"))
        if (helper === undefined || helper === unit) continue
        // A function that already calls the helper is not inlining it.
        if (unit.calls.includes(helper.file + "#" + helper.name)) continue
        pairs.push({ unit, helper, start, length })
        break
      }
    }

    if (pairs.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            bySequence.size +
              " declaration(s) whose whole body is a run of calls; no two share one",
          ]),
      }
    }

    // A bounded fan-out: one request per pair is the cache's requirement, and a
    // pathological repository should cost a budget rather than an afternoon.
    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      pairs.slice(0, maxPairs),
      (pair) =>
        Effect.gen(function* () {
          const body = callGraphEvidence(pair.unit, workspace)
          const helper = callGraphEvidence(pair.helper, workspace)
          const id = yield* atoms.add({ declared: body, existing: helper, length: pair.length })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: pair.unit.name + " (" + pair.unit.file + ")",
            concerns: [pair.unit.file, pair.helper.file],
            atoms: [id],
            violations: { same: ["same_operation"] },
            decisions: {
              same: Decision.classify({
                instructions: [
                  `Is \`atoms[${id}].declared\` the same operation as \`atoms[${id}].existing\`?`,
                  "Each side lists the calls it makes, resolved to the declaration each reaches, and the inputs each call reads.",
                  "Answer `same_operation` when the declared one could be replaced by a call to the existing one with no change in behaviour: the same work on the same inputs, in the same order.",
                  "Answer `different_inputs` when the two read different things, so they are two operations that happen to compose the same helpers.",
                  "Answer `different_order` when they call the same things in a different order, or interleave them differently.",
                  "Answer `different_work` when one does something the other does not.",
                ].join("\n"),
                criteria: {
                  same_operation: "The same work on the same inputs. One can call the other.",
                  different_inputs: "Same helpers, different inputs. Two operations, not one.",
                  different_order: "Same calls, different order or interleaving.",
                  different_work: "They do not do the same thing.",
                },
              }),
            },
            read: (answers) => answers,
          }
          return { pair, id, plan }
        }),
      { concurrency: "unbounded" },
    )

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = []
        planned.forEach((entry, index) => {
          const { pair } = entry
          const subject = pair.unit.name + " (" + pair.unit.file + ")"
          const answer = verdicts[index]
          const same = answer === undefined ? undefined : answer["same"]
          if (same === undefined || !("label" in same)) {
            // No judgement: report the fact unverified. A high-recall candidate
            // with no verdict is still a candidate a reader may want.
            diagnostics.push(
              findingFor(report, pair, workspace, "no judgement was available", "no judgement was available"),
            )
            return
          }
          if (same.label !== "same_operation") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason: "the model read them as " + same.label.replace(/_/g, " "),
            })
            return
          }
          const quality = qualityOf({
            score: probabilityOfLabel(same),
            margin: marginOfAnswer(same),
            confidence: same.confidence,
          })
          if (quality.quality === "drop") {
            drops.push({ ruleId: RULE_ID, subject, stage: "gated", reason: quality.reason })
            return
          }
          diagnostics.push(
            findingFor(
              report,
              pair,
              workspace,
              quality.quality === "act" ? undefined : quality.reason,
              "no judgement was available",
            ),
          )
        })
        return outcome(diagnostics, [], drops)
      },
    }
  }),
}

/** The probability the answer gave its own label. */
const probabilityOfLabel = (answer: { label: string; probabilities?: Record<string, number> }): number =>
  answer.probabilities?.[answer.label] ?? 0.7

/**
 * One declaration as a call graph, which is the state the question needs.
 *
 * `calls` are resolved to `file#name`; `inputs` are each call as written, which is
 * EVIDENCE rather than the verdict. The model sees that two functions call the
 * same three helpers and read different fields, and decides; a collapsed key
 * alone used to decide it.
 */
const callGraphEvidence = (unit: Unit, workspace: Workspace): Schema.Json => {
  const file = workspace.files.find((candidate) => candidate.path === unit.file)
  const sites =
    file === undefined
      ? []
      : file.facts.callSites.filter((site) => site.start >= unit.start && site.end <= unit.end)
  const inputs = sites.map((site) =>
    file === undefined ? "()" : file.text.slice(site.start, Math.min(site.end, site.start + 120)),
  )
  return {
    symbol: unit.name,
    path: unit.file,
    line: unit.location.line,
    calls: unit.calls.map(stripFile),
    inputs,
    source: unit.text.slice(0, policy.evidence.maxSourceChars),
    documented: unit.doc !== undefined,
    doc: unit.doc?.slice(0, policy.evidence.maxDocChars) ?? null,
  }
}

/** The finding for one candidate: verified, or the fact with the reason it is not. */
const findingFor = (
  report: Report,
  pair: { readonly unit: Unit; readonly helper: Unit; readonly start: number; readonly length: number },
  workspace: Workspace,
  unverifiedReason: string | undefined,
  fallbackReason: string,
): Diagnostic => {
  const { unit, helper, start, length } = pair
  const file = workspace.files.find((candidate) => candidate.path === unit.file)
  const sites =
    file === undefined
      ? []
      : file.facts.callSites.filter((site) => site.start >= unit.start && site.end <= unit.end)
  const first = sites[start]
  const starts = file === undefined ? [] : lineStarts(file.text)

  const edits: Array<Edit> = [
    {
      file: unit.file,
      line: first === undefined ? unit.location.line : lineAt(starts, first.start),
      column: 1,
      instruction: "replace these " + length + " call(s) with `" + helper.name + "` from " + helper.file,
    },
  ]
  if (helper.file !== unit.file) {
    edits.push({
      file: unit.file,
      line: 1,
      column: 1,
      instruction: "import `" + helper.name + "` from `" + helper.file + "`",
    })
  }

  const verified = unverifiedReason === undefined
  return report({
    about: unit,
    messageId: "inlined_helper",
    data: {
      name: unit.name,
      helper: helper.name,
      helperFile: helper.file,
      count: length,
      calls: unit.calls
        .slice(start, start + length)
        .map(stripFile)
        .join(" -> "),
      unverified: verified ? "" : " Not verified: " + (unverifiedReason ?? fallbackReason) + ".",
    },
    helpId: "inlined_helper_help",
    identity: [RULE_ID, unit.file, unit.name, helper.file, helper.name].join("\u0000"),
    judged: verified,
    severity: "info",
    repair: {
      operation: "replace",
      keep: helper.location,
      remove: [],
      cascade: edits,
      complete: true,
      settled: verified
        ? "the model read the two call graphs as the same operation"
        : "the call graphs match, so this is a candidate rather than a verdict",
    },
  })
}
