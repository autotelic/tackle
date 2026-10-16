import { Effect } from "effect"
import { parseSync } from "oxc-parser"
import { blockingErrors, isAstro, parseInputOf } from "../astro.ts"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import {
  budgetNote,
  declined,
  marginOfAnswer,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import { dataErrorVocabulary } from "../vocabulary.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Workspace } from "../workspace.ts"

const RULE_ID = "joggle/data-error-as-outage"

// A 5xx for a row that is not there.
//
// The amplifier the nullability work cannot see. A missing row is a normal
// outcome -- somebody deleted it, or the id is wrong -- and answering "the server
// is broken" turns one bad request into an outage signal: pagers, error budgets,
// retries against a request that will never succeed.
//
// THE CANDIDATE IS HIGH RECALL, AND IT DOES NOT DECIDE WHAT A ROW READ IS.
//
// An earlier version of this rule decided "does this branch read a row?" in code,
// by the callee's name: `find*`, `get*`, `load*`, and `parse*`. That was the
// classifier's work done ahead of time. Against a real repository it missed a
// read named inside a callback, a bare call, and a read whose verb was not on the
// list -- three false negatives a reviewer had to find by hand, because a
// candidate that is never sent cannot be recovered by any answer. So the code now
// finds the SHAPE that could be about a row (a nullish guard, or a catch, that
// answers a 5xx) and asks the model the question the names were guessing at.
//
// Two questions, atomic, answered against the same state:
//   about_a_row  is the branch about a row in a data store?   (Noul)
//   verdict      is the absent row normal, or a broken invariant? (Choice)
// Code composes them: report only when the branch IS about a row and the absence
// is normal. The names are gone; the state carries the answer.

/** The method names that emit an HTTP status. */
const STATUS_METHODS = new Set(["code", "status", "statusCode"])

/** The node kinds that make a scope for the status walk. */
const FUNCTION_KINDS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The name a call names, bare or dotted: `getComments` -> `getComments`,
 * `reply.code` -> `code`.
 *
 * Used only to READ a status or to describe a branch in the state. It no longer
 * decides whether anything is a row read -- that is the question.
 */
const calleeName = (callee: unknown): string | undefined => {
  if (!isRecord(callee)) return undefined
  if (callee["type"] === "Identifier" && typeof callee["name"] === "string") return callee["name"]
  if (callee["type"] !== "MemberExpression") return undefined
  const property = callee["property"]
  return isRecord(property) && typeof property["name"] === "string" ? property["name"] : undefined
}

/**
 * Visit every node under `root` that is NOT inside a nested function.
 *
 * The guard and the status have to belong to the SAME handler. A walk that
 * descends into nested functions attributes an inner callback's status to an
 * outer handler, which is a candidate that never existed.
 */
const eachOwn = (root: unknown, visit: (node: Record<string, unknown>) => void): void => {
  const stack: Array<unknown> = []
  const pushChildren = (node: Record<string, unknown>): void => {
    for (const value of Object.values(node)) {
      if (value !== null && typeof value === "object") stack.push(value)
    }
  }
  if (!isRecord(root)) return
  pushChildren(root)
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child)
      continue
    }
    if (!isRecord(node)) continue
    if (FUNCTION_KINDS.has(String(node["type"]))) continue
    visit(node)
    pushChildren(node)
  }
}

/** The variable a nullish guard tests: `!row`, `row == null`, `row === undefined`. */
const guardedVariable = (test: unknown): string | undefined => {
  if (!isRecord(test)) return undefined
  if (test["type"] === "UnaryExpression" && test["operator"] === "!" && isRecord(test["argument"])) {
    const argument = test["argument"]
    return argument["type"] === "Identifier" && typeof argument["name"] === "string"
      ? argument["name"]
      : undefined
  }
  if (test["type"] === "BinaryExpression") {
    const operator = test["operator"]
    if (operator !== "==" && operator !== "===" && operator !== "!=" && operator !== "!==") return undefined
    const sides = [test["left"], test["right"]]
    const identifier = sides.find(
      (side): side is Record<string, unknown> => isRecord(side) && side["type"] === "Identifier",
    )
    const nullish = sides.some((side) => {
      if (!isRecord(side)) return false
      if (side["type"] === "Literal") {
        const value = side["value"]
        const raw = side["raw"]
        return value === null || raw === "null" || raw === "undefined"
      }
      return side["type"] === "Identifier" && side["name"] === "undefined"
    })
    return nullish && identifier !== undefined && typeof identifier["name"] === "string"
      ? identifier["name"]
      : undefined
  }
  return undefined
}

/** The 5xx emitted in this subtree: `.code(500)` or `x.statusCode = 503`. */
const outageIn = (root: unknown): number | undefined => {
  let found: number | undefined
  eachOwn(root, (node) => {
    if (found !== undefined) return
    if (node["type"] === "CallExpression" && STATUS_METHODS.has(calleeName(node["callee"]) ?? "")) {
      const args = node["arguments"]
      const first = Array.isArray(args) ? args[0] : undefined
      if (isRecord(first) && first["type"] === "Literal" && typeof first["value"] === "number") {
        const code = first["value"]
        if (code >= 500 && code <= 599) found = code
      }
    }
    if (node["type"] === "AssignmentExpression" && isRecord(node["left"]) && isRecord(node["right"])) {
      const left = node["left"]
      const right = node["right"]
      if (
        isRecord(left["property"]) &&
        left["property"]["name"] === "statusCode" &&
        right["type"] === "Literal" &&
        typeof right["value"] === "number" &&
        right["value"] >= 500 &&
        right["value"] <= 599
      ) {
        found = right["value"]
      }
    }
  })
  return found
}

export interface Outage {
  readonly file: string
  readonly line: number
  readonly handler: string
  /** How the 5xx is reached: a nullish guard, or a catch. */
  readonly reached: "guard" | "catch"
  /** A description of the branch: the guarded binding, or the try s first call. */
  readonly trigger: string
  readonly statusCode: number
  /** The handler s source, bounded, which is the state the questions read. */
  readonly handlerSource: string
}

/**
 * One candidate per handler: a branch that could be about a row and answers a 5xx.
 *
 * No name decides this. A nullish guard with a 5xx inside, or a try whose catch
 * answers a 5xx, is the shape; whether the branch is about a ROW is the question.
 */
const candidatesIn = (workspace: Workspace, scope: Scope): ReadonlyArray<Outage> => {
  const found: Array<Outage> = []
  for (const file of workspace.files) {
    if (scope.changed !== undefined && !scope.changed.has(file.path)) continue
    // A cheap gate from the facts already indexed, so only a file that could hold
    // a candidate is parsed a second time.
    const names = file.facts.callSites.map((site) => site.name.split(".").at(-1) ?? "")
    if (!names.some((name) => STATUS_METHODS.has(name)) && !file.text.includes("statusCode")) continue

    const parsed = parseSync(
      file.path,
      parseInputOf({ file: file.path, text: file.text }),
      isAstro(file.path) ? { sourceType: "module", lang: "ts" } : undefined,
    )
    if (blockingErrors(file.path, parsed.errors).length > 0) continue

    // Each function WITH its parent, so an anonymous handler can be named from the
    // call it was handed to -- `fastify.decorate('getComments', async ...)`.
    const functions: Array<{
      readonly node: Record<string, unknown>
      readonly parent: Record<string, unknown> | undefined
    }> = []
    const collect = (root: unknown): void => {
      const stack: Array<readonly [unknown, Record<string, unknown> | undefined]> = [[root, undefined]]
      while (stack.length > 0) {
        const [node, parent] = stack.pop() as readonly [unknown, Record<string, unknown> | undefined]
        if (Array.isArray(node)) {
          for (const child of node) stack.push([child, parent])
          continue
        }
        if (!isRecord(node)) continue
        if (FUNCTION_KINDS.has(String(node["type"]))) functions.push({ node, parent })
        for (const value of Object.values(node)) {
          if (value !== null && typeof value === "object") stack.push([value, node])
        }
      }
    }
    collect(parsed.program)

    const nameFromCaller = (parent: Record<string, unknown> | undefined): string | undefined => {
      if (!isRecord(parent) || parent["type"] !== "CallExpression") return undefined
      const args = parent["arguments"]
      if (Array.isArray(args)) {
        for (const arg of args) {
          if (isRecord(arg) && typeof arg["value"] === "string" && arg["value"] !== "") return arg["value"]
        }
      }
      return calleeName(parent["callee"])
    }

    for (const { node: handler, parent: handlerParent } of functions) {
      const start = handler["start"]
      if (typeof start !== "number") continue
      const body = handler["body"]
      if (body === undefined) continue

      const line = file.text.slice(0, start).split("\n").length
      const handlerName =
        isRecord(handler["id"]) && typeof handler["id"]["name"] === "string"
          ? handler["id"]["name"]
          : (nameFromCaller(handlerParent) ?? "handler")
      const source = file.text.slice(
        start,
        Math.min(file.text.length, start + policy.evidence.maxSourceChars),
      )

      let candidate: Outage | undefined
      // Narrower first: a guard on a value's absence. The guard shape is a subset
      // of the catch shape's reach, so it is preferred when both are present.
      eachOwn(body, (node) => {
        if (candidate !== undefined || node["type"] !== "IfStatement") return
        const guarded = guardedVariable(node["test"])
        if (guarded === undefined) return
        const code = outageIn(node["consequent"])
        if (code === undefined) return
        candidate = {
          file: file.path,
          line,
          handler: handlerName,
          reached: "guard",
          trigger: guarded,
          statusCode: code,
          handlerSource: source,
        }
      })
      // Wider: a catch that answers a 5xx. Whether the try read a row is the
      // question, not a name lookup.
      if (candidate === undefined) {
        eachOwn(body, (node) => {
          if (candidate !== undefined || node["type"] !== "TryStatement") return
          const handlerNode = node["handler"]
          if (!isRecord(handlerNode)) return
          const code = outageIn(handlerNode["body"])
          if (code === undefined) return
          candidate = {
            file: file.path,
            line,
            handler: handlerName,
            reached: "catch",
            trigger: "",
            statusCode: code,
            handlerSource: source,
          }
        })
      }
      if (candidate !== undefined) found.push(candidate)
    }
  }
  // Two handlers can share a start line once nested functions are in play; the
  // identity is the file and the line, so one candidate is kept.
  const seen = new Set<string>()
  return found.filter((entry) => {
    const key = entry.file + "\u0000" + String(entry.line)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const labelOf = (outage: Outage): string => outage.handler + " (" + outage.file + ":" + String(outage.line) + ")"

/** How the 5xx is reached, in the reader's terms. */
const describe = (outage: Outage): string =>
  outage.reached === "guard"
    ? "when `" + outage.trigger + "` is empty"
    : "when reading the row fails"

const findingFor = (report: Report, outage: Outage, unverified: string | undefined): Diagnostic =>
  report({
    about: { file: outage.file, line: outage.line, column: 1 },
    messageId: "outage",
    data: {
      handler: outage.handler,
      code: outage.statusCode,
      describe: describe(outage),
      closing:
        unverified === undefined
          ? "Pin a deliberate 5xx in .joggle/answers/ so the question is not asked again."
          : "Not verified: " + unverified + ".",
    },
    helpId: "outage_help",
    identity: [RULE_ID, outage.file, outage.handler, String(outage.statusCode)].join("\u0000"),
    judged: unverified === undefined,
    severity: "warn",
  })

export const dataErrorAsOutage: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A 5xx answer to a row that is simply not there.",
  judged: true,
  onUnavailable: "report",
  messages: messages({
    outage:
      "`{{handler}}` answers {{code}} {{describe}}, so a missing row reads as a server outage.",
    outage_help:
      "A lookup that finds nothing is usually a normal outcome: a 404, an empty list, or a 4xx the caller caused. If the absence really is a broken invariant, say so here; otherwise answer the request. {{closing}}",
  }),
  plan: Effect.fn("joggle/data-error-as-outage")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(dataErrorAsOutage, locator(workspace))
    const all = candidatesIn(workspace, scope)
    if (all.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no branch answers a 5xx for a guarded or failed read: the guard and the status did not meet",
          ]),
      }
    }

    const budget = policy.dataError.maxHandlers
    const judged = all.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = all.slice(budget).map((outage) => ({
      ruleId: RULE_ID,
      subject: labelOf(outage),
      stage: "budget" as const,
      reason: "past the budget of " + String(budget) + " handlers",
    }))

    const atoms = yield* Atoms
    const planned: Array<{ readonly outage: Outage; readonly plan: Plan<DecisionAnswers> }> = []
    for (const outage of judged) {
      const id = yield* atoms.add({
        handler: outage.handler,
        reached: outage.reached,
        status: outage.statusCode,
        trigger: outage.trigger,
        source: outage.handlerSource,
      })
      // The predicate the candidate used to guess at, now asked. Each shape gets
      // the question it needs: a guard tests a VALUE (is it a row?), a catch wraps
      // a TRY (does it read a row?). Asking a catch whether "the branch concerns a
      // row" got "it is error handling" -- the branch is the catch, the read is the
      // try, and the question has to point at the try.
      const aboutInstructions =
        outage.reached === "guard"
          ? [
              `\`atoms[${id}].source\` is an HTTP handler that answers \`atoms[${id}].status\` when \`atoms[${id}].trigger\` is empty.`,
              `Is \`atoms[${id}].trigger\` a row in a data store, so that an empty value is a row that is absent?`,
              "Answer true when it is a database record or a stored entity.",
              "Answer false when it is the request, a cache entry, configuration, an external service response, or an unrelated value.",
            ]
          : [
              `\`atoms[${id}].source\` is an HTTP handler that answers \`atoms[${id}].status\` in a \`catch\`. The \`try\` it wraps is in \`atoms[${id}].source\`.`,
              "Does that `try` read or decode a row in a data store, so that a missing or undecodable row is a plausible cause of the failure it catches?",
              "Answer true when the try reads or decodes a database record or a stored entity.",
              "Answer false when the try only writes, validates input, calls an external service, or does unrelated work.",
            ]
      const verdictInstructions =
        outage.reached === "guard"
          ? [
              `\`atoms[${id}].source\` answers \`atoms[${id}].status\` when \`atoms[${id}].trigger\` is empty.`,
              "Is an empty row here a normal outcome, or a broken invariant?",
              "Answer `row_absence_is_normal` when the request can legitimately name a row that is not there -- a wrong id, a deleted record, an empty result set.",
              "Answer `row_absence_is_an_error` when an empty row here means data that must exist does not, so a 5xx is honest.",
              "Answer `not_applicable` when the branch is not about a row's absence.",
            ]
          : [
              `\`atoms[${id}].source\` answers \`atoms[${id}].status\` in a \`catch\`. The \`try\` it wraps is in \`atoms[${id}].source\`.`,
              "When that read fails, is the likely cause a missing or undecodable row (a data fact), or a genuine server fault?",
              "Answer `row_absence_is_normal` when the failure is the data being absent or undecodable -- a wrong id, a deleted record, a row that does not match the contract -- so a 5xx misreports a data fact as a server outage.",
              "Answer `row_absence_is_an_error` when the failure is a genuine server fault, so a 5xx is honest.",
              "Answer `not_applicable` when the branch is not about a row's absence.",
            ]
      planned.push({
        outage,
        plan: {
          ruleId: RULE_ID,
          subject: labelOf(outage),
          concerns: [outage.file],
          atoms: [id],
          violations: { about_a_row: [] },
          decisions: {
            about_a_row: Decision.probability({
              instructions: aboutInstructions.join("\n"),
              criteria: {
                false: "The branch is not about a row.",
                true: "The branch is about a row.",
              },
            }),
            verdict: Decision.classify({
              instructions: verdictInstructions.join("\n"),
              criteria: dataErrorVocabulary,
            }),
          },
          read: (answers) => answers,
        },
      })
    }

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        planned.forEach((entry, index) => {
          const outage = entry.outage
          const answer = verdicts[index]
          const about = answer === undefined ? undefined : answer["about_a_row"]
          const verdict = answer === undefined ? undefined : answer["verdict"]
          if (
            about === undefined ||
            !("probability" in about) ||
            verdict === undefined ||
            !("label" in verdict)
          ) {
            // A nullish guard with a 5xx inside is specific enough to report
            // without a judgement. A catch that answers a 5xx is not: every
            // ordinary error handler has one, so reporting it unverified would
            // be the noise the verification exists to remove.
            if (outage.reached === "guard") {
              diagnostics.push(findingFor(report, outage, "no judgement was available"))
            } else {
              drops.push({
                ruleId: RULE_ID,
                subject: labelOf(outage),
                stage: "unreadable",
                reason: "not judged, and a `catch` that answers a 5xx is too common to report without one",
              })
            }
            return
          }
          // The verification the name prefixes used to skip: is this branch about
          // a row at all? A low probability is the model saying no, which is a
          // verdict, not a shrug -- so it is a decline, not a gate failure.
          if (about.probability < policy.decision.gates.probabilityFloor) {
            drops.push({
              ruleId: RULE_ID,
              subject: labelOf(outage),
              stage: "declined",
              reason: "the branch is not about a row (probability " + about.probability.toFixed(2) + ")",
            })
            return
          }
          if (declined(verdict.label)) {
            drops.push({
              ruleId: RULE_ID,
              subject: labelOf(outage),
              stage: "declined",
              reason: "the model read the branch as not about a row's absence",
            })
            return
          }
          if (verdict.label !== "row_absence_is_normal") {
            drops.push({
              ruleId: RULE_ID,
              subject: labelOf(outage),
              stage: "declined",
              reason: "the model read the absence as a broken invariant, so a 5xx is honest",
            })
            return
          }
          const quality = qualityOf({
            score: about.probability,
            margin: marginOfAnswer(verdict),
            confidence: verdict.confidence,
          })
          if (quality.quality === "drop") {
            drops.push({ ruleId: RULE_ID, subject: labelOf(outage), stage: "gated", reason: quality.reason })
            return
          }
          diagnostics.push(
            findingFor(report, outage, quality.quality === "act" ? undefined : quality.reason),
          )
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "handlers",
            judged: budget,
            candidates: all.length,
            sample: all.slice(budget).map(labelOf),
          }),
          drops,
        )
      },
    }
  }),
}

// meta-allow: no-pattern-classifier -- `status`, `code`, `statusCode` are the HTTP
// framework's own method names, a language-level fact like the `node:` builtins in
// dependency-fit, not this repository's naming. A checker host would make it exact;
// until then it is a framework vocabulary. docs/rule-coupling.md.
