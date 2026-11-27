import { Effect, Result } from "effect"
import { Decision } from "effect/ai"
import type { DecisionModel } from "effect/ai"
import { Atoms } from "./atoms.ts"
import { canonical } from "./canonical.ts"
import { policy } from "./policy.ts"
import { answerPlansRaw, PlanAnswers, chunkPlans, type Plan } from "./plans.ts"
import { shortHash } from "./state.ts"
import { createFactStore, type StoredFinding } from "./store.ts"

/*
 * A remedy is a column, not a prose answer.
 *
 * Every finding says what is wrong. Most also say what to do about it, and the
 * useful number is not how many findings a repository has but how many distinct
 * repairs they ask for. That normalisation is a judgement because two messages
 * can prescribe one repair in two vocabularies; the deterministic witness (the
 * imperative clause with the diagnosis dropped) is kept beside it, because a
 * disagreement between the cheap computation and the judgement is itself the
 * finding.
 *
 * The input is always a findings stream, never a rule set: joggle's own JSON and
 * oxlint's JSON both arrive here unchanged.
 */

export interface RemedyFinding {
  /** `file:line`, as the fact store records it. */
  readonly site: string
  readonly file: string
  readonly line: number
  readonly rule: string
  readonly message: string
  readonly help?: string | undefined
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const textOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

const firstLabel = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) return undefined
  const first: unknown = value[0]
  return isRecord(first) ? first : undefined
}

const nestedLine = (diagnostic: Readonly<Record<string, unknown>>): number | undefined => {
  const location = diagnostic["location"]
  const located = isRecord(location) ? numberOf(location["line"]) : undefined
  if (located !== undefined) return located
  const label = firstLabel(diagnostic["labels"])
  const span = label === undefined ? undefined : label["span"]
  return isRecord(span) ? numberOf(span["line"]) : undefined
}

/**
 * Read either engine's JSON, without asking either to change.
 *
 * oxlint names the file `filename`, calls the rule `code`, and puts the line
 * inside its first label span; joggle names them `location.file`, `ruleId` and
 * `location.line`. The reader accepts both and degrades a missing line to 1
 * rather than dropping the finding: an unlocated finding is still a finding.
 */
export const findingsOf = (payload: unknown): ReadonlyArray<RemedyFinding> => {
  const diagnostics: ReadonlyArray<unknown> = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload["diagnostics"])
      ? payload["diagnostics"]
      : []
  const out: Array<RemedyFinding> = []
  for (const raw of diagnostics) {
    if (!isRecord(raw)) continue
    const location = raw["location"]
    const located = isRecord(location) ? location : undefined
    const file =
      textOf(raw["filename"]) ??
      textOf(raw["file"]) ??
      (located === undefined ? undefined : textOf(located["file"])) ??
      "<unknown>"
    const line =
      numberOf(raw["line"]) ??
      (located === undefined ? undefined : numberOf(located["line"])) ??
      nestedLine(raw) ??
      1
    const rule = textOf(raw["code"]) ?? textOf(raw["ruleId"]) ?? "unknown"
    const message = textOf(raw["message"]) ?? ""
    const help = textOf(raw["help"])
    out.push({
      site: file + ":" + String(line),
      file,
      line,
      rule,
      message,
      ...(help === undefined ? {} : { help }),
    })
  }
  return out
}

/**
 * The deterministic witness: the last sentence, which is the imperative one.
 *
 * Rule messages are written diagnosis first, remedy second ("Type assertion
 * discards type evidence. Narrow with…"). Taking the final sentence drops the
 * diagnosis and keeps the instruction without knowing any rule id. It is a
 * witness, not the normaliser: two rules can describe one repair in two
 * vocabularies, and only the judgement can say so.
 */
export const witnessClause = (message: string): string => {
  const normalized = message.replace(/`/gu, "").replace(/\s+/gu, " ").trim()
  if (normalized === "") return "none"
  const sentences = normalized
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "")
  const clause = sentences.at(-1) ?? normalized
  return clause.replace(/[.!?]+$/u, "").trim() || "none"
}

interface MessageNode {
  readonly key: string
  readonly message: string
  readonly help: string | undefined
  readonly clause: string
  readonly findings: ReadonlyArray<RemedyFinding>
}

export const messageKeyOf = (finding: RemedyFinding): string =>
  canonical({ message: finding.message, help: finding.help ?? "" })

const messageNodesOf = (findings: ReadonlyArray<RemedyFinding>): ReadonlyArray<MessageNode> => {
  const byKey = new Map<
    string,
    { message: string; help: string | undefined; clause: string; findings: Array<RemedyFinding> }
  >()
  for (const finding of findings) {
    const key = messageKeyOf(finding)
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, {
        message: finding.message,
        help: finding.help,
        clause: witnessClause(finding.message),
        findings: [finding],
      })
    } else {
      existing.findings.push(finding)
    }
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      message: value.message,
      help: value.help,
      clause: value.clause,
      findings: value.findings,
    }))
}

export interface RepairOpinion {
  /** Message key to the repair label the judgement chose. */
  readonly repairs: ReadonlyMap<string, string>
  /** Message key pair to the probability the two prescribe the same repair. */
  readonly same: ReadonlyMap<string, number>
  /** Set when the model was never reached; witness-only clustering follows. */
  readonly unavailable?: string | undefined
  readonly questions: number
  readonly pairs: number
}

export const pairKeyOf = (left: string, right: string): string =>
  left.localeCompare(right) <= 0 ? left + "\u0000" + right : right + "\u0000" + left

interface ClauseGroup {
  readonly clause: string
  readonly messages: ReadonlyArray<MessageNode>
}

const groupsOf = (messages: ReadonlyArray<MessageNode>): ReadonlyArray<ClauseGroup> => {
  const byClause = new Map<string, Array<MessageNode>>()
  for (const message of messages) {
    const list = byClause.get(message.clause)
    if (list === undefined) byClause.set(message.clause, [message])
    else list.push(message)
  }
  return [...byClause.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([clause, list]) => ({ clause, messages: list }))
}

/**
 * Ask the two questions rung 1 needs, batched and cached.
 *
 * `j_repair` labels each distinct message against the candidate clauses code
 * derived from the corpus. `j_same` compares one representative of each pair of
 * witness groups, which is the only pair that can change the clustering: two
 * messages with the same witness are already one node, and two with different
 * witnesses are where a judgement can find a repair the regex cannot.
 */
export const judgeRemedies = (
  findings: ReadonlyArray<RemedyFinding>,
): Effect.Effect<RepairOpinion, never, Atoms | PlanAnswers | DecisionModel.DecisionModel> =>
  Effect.gen(function* () {
    const atoms = yield* Atoms
    const messages = messageNodesOf(findings)
    const groups = groupsOf(messages)
    const clauses = [...new Set([...groups.map((group) => group.clause), "none"])].sort(
      (left, right) => left.localeCompare(right),
    )
    const plans: Array<Plan<unknown>> = []
    const repairs: Array<string> = []
    const pairs: Array<{ readonly key: string }> = []

    for (const message of messages) {
      const state = {
        finding: { message: message.message, help: message.help ?? "" },
        candidates: clauses,
      }
      const atom = yield* atoms.add(state)
      const decision = Decision.classify({
        instructions: [
          "Which repair does `finding.message` prescribe, given `finding.help`?",
          "Choose `none` if no candidate applies.",
          "Answer about what the message tells a reader to DO, not which rule produced it.",
        ].join("\n"),
        criteria: Object.fromEntries(
          clauses.map((clause) => [
            clause,
            clause === "none" ? "No candidate repair applies." : clause,
          ]),
        ),
      })
      plans.push({
        ruleId: "joggle/remedies",
        subject: message.key,
        concerns: [],
        atoms: [atom],
        decisions: { repair: decision },
        read: (answers) => {
          const answer = answers["repair"]
          return answer !== undefined && "label" in answer ? answer.label : undefined
        },
      })
      repairs.push(message.key)
    }

    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        const a = groups[left]?.messages[0]
        const b = groups[right]?.messages[0]
        if (a === undefined || b === undefined) continue
        const key = pairKeyOf(a.key, b.key)
        const state = {
          a: { message: a.message, rule: a.findings[0]?.rule ?? "unknown" },
          b: { message: b.message, rule: b.findings[0]?.rule ?? "unknown" },
        }
        const atom = yield* atoms.add(state)
        plans.push({
          ruleId: "joggle/remedies",
          subject: key,
          concerns: [],
          atoms: [atom],
          decisions: {
            same: Decision.probability({
              instructions: [
                "Do `a.message` and `b.message` prescribe the same repair, given `a.rule`" +
                  " and `b.rule`?",
                "Answer about the action the reader must take, not the words the two rules use.",
                "Answer true when fixing either finding would be the same edit, or the same" +
                  " kind of edit at the same boundary.",
              ].join("\n"),
              criteria: {
                false: "They prescribe different repairs.",
                true: "They prescribe the same repair.",
              },
            }),
          },
          read: (answers) => {
            const answer = answers["same"]
            return answer !== undefined && "probability" in answer ? answer.probability : undefined
          },
        })
        pairs.push({ key })
      }
    }

    const read = new Map<number, unknown>()
    let unavailable: string | undefined
    let offset = 0
    for (const chunk of yield* chunkPlans(plans, policy.decision.maxStateChars)) {
      const attempted = yield* Effect.result(answerPlansRaw(chunk.plans))
      if (Result.isFailure(attempted)) {
        unavailable ??= String(attempted.failure)
      } else {
        attempted.success.forEach((record, index) => {
          // `answerPlansRaw` preserves the chunk's plan order, and the chunk came
          // from the run's list, so the running offset is the plan's index.
          read.set(offset + index, chunk.plans[index]?.read(record))
        })
      }
      offset += chunk.plans.length
    }

    const repairMap = new Map<string, string>()
    repairs.forEach((key, index) => {
      const answer = read.get(index)
      if (typeof answer === "string" && answer !== "") repairMap.set(key, answer)
    })
    const sameMap = new Map<string, number>()
    const pairStart = repairs.length
    pairs.forEach((pair, index) => {
      const answer = read.get(pairStart + index)
      if (typeof answer === "number") sameMap.set(pair.key, answer)
    })
    return {
      repairs: repairMap,
      same: sameMap,
      ...(unavailable === undefined ? {} : { unavailable }),
      questions: messages.length,
      pairs: pairs.length,
    }
  })

export interface RuleSites {
  readonly rule: string
  readonly findings: number
  readonly sites: ReadonlyArray<string>
}

export interface Counterexample {
  readonly a: string
  readonly b: string
  /** Sites `a` reaches that `b` cannot. */
  readonly onlyA: ReadonlyArray<string>
  /** Sites `b` reaches that `a` cannot. */
  readonly onlyB: ReadonlyArray<string>
  readonly both: ReadonlyArray<string>
  /** The computed fact that explains the difference, never a judgement. */
  readonly reason: string
}

export interface RemedyCluster {
  readonly remedy: string
  readonly remedyHash: string
  readonly sites: number
  readonly findings: number
  readonly rules: ReadonlyArray<RuleSites>
  readonly files: ReadonlyArray<{ readonly file: string; readonly sites: number }>
  readonly counterexamples: ReadonlyArray<Counterexample>
  readonly members: ReadonlyArray<RemedyFinding>
}

export interface ClusterSummary {
  readonly clusters: number
  readonly largestSites: number
  readonly largestRules: number
}

export interface RemedyReport {
  readonly findings: number
  readonly distinctMessages: number
  readonly pairsAsked: number
  readonly judgementUnavailable: string | undefined
  readonly witness: ClusterSummary
  readonly judgement: ClusterSummary
  readonly disagreements: ReadonlyArray<{
    readonly a: string
    readonly b: string
    readonly probability: number
  }>
  readonly clusters: ReadonlyArray<RemedyCluster>
}

type Mode = "witness" | "judgement" | "union"

const sameRepair = (opinion: RepairOpinion, left: string, right: string): boolean => {
  // The Choice is the normaliser: two messages the model put on one candidate
  // clause prescribe one repair, whatever their wording. The pairwise Noul is
  // the second opinion, for two messages that each kept their own clause.
  const leftRepair = opinion.repairs.get(left)
  const rightRepair = opinion.repairs.get(right)
  if (leftRepair !== undefined && leftRepair === rightRepair && leftRepair !== "none") {
    return true
  }
  const probability = opinion.same.get(pairKeyOf(left, right))
  return probability !== undefined && probability >= policy.decision.gates.probabilityFloor
}

interface DisjointSet {
  readonly find: (index: number) => number
  readonly union: (left: number, right: number) => void
}

const disjointSetOf = (size: number): DisjointSet => {
  const parent = Array.from({ length: size }, (_, index) => index)
  const find = (index: number): number => {
    const current = parent[index] ?? index
    if (current === index) return index
    const root = find(current)
    parent[index] = root
    return root
  }
  return {
    find,
    union: (left, right) => {
      const a = find(left)
      const b = find(right)
      if (a !== b) parent[b] = a
    },
  }
}

const rulesOf = (findings: ReadonlyArray<RemedyFinding>): ReadonlyArray<RuleSites> => {
  const byRule = new Map<string, { findings: number; sites: Set<string> }>()
  for (const finding of findings) {
    const entry = byRule.get(finding.rule)
    if (entry === undefined) {
      byRule.set(finding.rule, { findings: 1, sites: new Set([finding.site]) })
    } else {
      entry.findings += 1
      entry.sites.add(finding.site)
    }
  }
  return [...byRule.entries()]
    .map(([rule, entry]) => ({
      rule,
      findings: entry.findings,
      sites: [...entry.sites].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => right.findings - left.findings || left.rule.localeCompare(right.rule))
}

const counterexamplesOf = (
  findings: ReadonlyArray<RemedyFinding>,
): ReadonlyArray<Counterexample> => {
  const rules = rulesOf(findings)
  const out: Array<Counterexample> = []
  for (let left = 0; left < rules.length; left += 1) {
    for (let right = left + 1; right < rules.length; right += 1) {
      const a = rules[left]
      const b = rules[right]
      if (a === undefined || b === undefined) continue
      const aSites = new Set(a.sites)
      const bSites = new Set(b.sites)
      const onlyA = a.sites.filter((site) => !bSites.has(site))
      const onlyB = b.sites.filter((site) => !aSites.has(site))
      const both = a.sites.filter((site) => bSites.has(site))
      const sampleA = findings.find(
        (finding) => finding.rule === a.rule && onlyA.includes(finding.site),
      )
      const sampleB = findings.find(
        (finding) => finding.rule === b.rule && onlyB.includes(finding.site),
      )
      const reason =
        onlyA.length === 0 && onlyB.length === 0
          ? "Every site carries both rules."
          : "At the `" +
            a.rule +
            "`-only sites the message is " +
            JSON.stringify(sampleA?.message ?? a.rule) +
            ", and no `" +
            b.rule +
            "` finding is present there; at the `" +
            b.rule +
            "`-only sites it is " +
            JSON.stringify(sampleB?.message ?? b.rule) +
            ", and no `" +
            a.rule +
            "` finding is present. The triggers differ: " +
            String(onlyA.length) +
            " site(s) one way, " +
            String(onlyB.length) +
            " the other."
      out.push({ a: a.rule, b: b.rule, onlyA, onlyB, both, reason })
    }
  }
  return out
}

const clustersOf = (
  findings: ReadonlyArray<RemedyFinding>,
  opinion: RepairOpinion,
  mode: Mode,
): ReadonlyArray<RemedyCluster> => {
  const messages = messageNodesOf(findings)
  const groups = groupsOf(messages)
  const groupIndex = new Map<string, number>()
  groups.forEach((group, index) => groupIndex.set(group.clause, index))
  const sets = disjointSetOf(groups.length)

  if (mode !== "witness") {
    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        const a = groups[left]?.messages[0]
        const b = groups[right]?.messages[0]
        if (a === undefined || b === undefined) continue
        if (sameRepair(opinion, a.key, b.key)) sets.union(left, right)
      }
    }
  }
  const byRoot = new Map<number, Array<RemedyFinding>>()
  for (const finding of findings) {
    const clause = witnessClause(finding.message)
    const index = groupIndex.get(clause)
    if (index === undefined) continue
    const root = sets.find(index)
    const list = byRoot.get(root)
    if (list === undefined) byRoot.set(root, [finding])
    else list.push(finding)
  }

  const clusters: Array<RemedyCluster> = []
  for (const members of byRoot.values()) {
    const repairCounts = new Map<string, number>()
    for (const member of members) {
      const label = opinion.repairs.get(messageKeyOf(member)) ?? witnessClause(member.message)
      repairCounts.set(label, (repairCounts.get(label) ?? 0) + 1)
    }
    const remedy =
      [...repairCounts.entries()].sort(
        ([leftLabel, leftCount], [rightLabel, rightCount]) =>
          rightCount - leftCount || leftLabel.localeCompare(rightLabel),
      )[0]?.[0] ?? "none"
    const sites = [...new Set(members.map((member) => member.site))].sort((left, right) =>
      left.localeCompare(right),
    )
    const fileCounts = new Map<string, Set<string>>()
    for (const member of members) {
      const set = fileCounts.get(member.file)
      if (set === undefined) fileCounts.set(member.file, new Set([member.site]))
      else set.add(member.site)
    }
    clusters.push({
      remedy,
      remedyHash: shortHash(canonical({ remedy })),
      sites: sites.length,
      findings: members.length,
      rules: rulesOf(members),
      files: [...fileCounts.entries()]
        .map(([file, set]) => ({ file, sites: set.size }))
        .sort((left, right) => right.sites - left.sites || left.file.localeCompare(right.file)),
      counterexamples: counterexamplesOf(members),
      members,
    })
  }
  return clusters.sort(
    (left, right) => right.sites - left.sites || left.remedy.localeCompare(right.remedy),
  )
}

const summaryOf = (clusters: ReadonlyArray<RemedyCluster>): ClusterSummary => {
  const largest = clusters[0]
  return {
    clusters: clusters.length,
    largestSites: largest?.sites ?? 0,
    largestRules: largest?.rules.length ?? 0,
  }
}

/**
 * Turn findings into remedy clusters.
 *
 * The judgement can only add an edge the witness did not see; it cannot delete
 * one the witness found. That is deliberate for rung 1: the cost of missing a
 * shared repair is a reader fixing two places for one concept, while the cost of
 * an extra edge is visible in the counterexample pack, which lists exactly the
 * sites one rule reaches that the other cannot.
 */
export const clusterRemedies = (
  findings: ReadonlyArray<RemedyFinding>,
  opinion: RepairOpinion,
): RemedyReport => {
  const messages = messageNodesOf(findings)
  const judges = clustersOf(findings, opinion, "judgement")
  const witnesses = clustersOf(findings, { ...opinion, same: new Map() }, "witness")
  const clusters = clustersOf(findings, opinion, "union")
  const disagreements: Array<{ a: string; b: string; probability: number }> = []
  for (const [key, probability] of opinion.same) {
    if (probability < policy.decision.gates.probabilityFloor) continue
    const [left, right] = key.split("\u0000")
    if (left === undefined || right === undefined) continue
    const leftMessage = messages.find((message) => message.key === left)
    const rightMessage = messages.find((message) => message.key === right)
    if (leftMessage === undefined || rightMessage === undefined) continue
    if (leftMessage.clause === rightMessage.clause) continue
    disagreements.push({ a: leftMessage.clause, b: rightMessage.clause, probability })
  }
  return {
    findings: findings.length,
    distinctMessages: messages.length,
    pairsAsked: opinion.pairs,
    judgementUnavailable: opinion.unavailable,
    witness: summaryOf(witnesses),
    judgement: summaryOf(judges),
    disagreements,
    clusters,
  }
}

/** Persist one run's clusters as the new `finding` rows. */
export const rememberRemedyFindings = (
  root: string,
  report: RemedyReport,
): { readonly run: string; readonly written: number } => {
  const run = shortHash(
    canonical(
      report.clusters
        .flatMap((cluster) =>
          cluster.members.map((member) => ({
            site: member.site,
            rule: member.rule,
            remedy: cluster.remedyHash,
          })),
        )
        .sort((left, right) =>
          (left.site + "\u0000" + left.rule).localeCompare(right.site + "\u0000" + right.rule),
        ),
    ),
  )
  const rows: Array<Omit<StoredFinding, "run">> = report.clusters.flatMap((cluster) =>
    cluster.members.map((member) => ({
      site: member.site,
      rule: member.rule,
      remedyHash: cluster.remedyHash,
    })),
  )
  const store = createFactStore(root)
  const written = store.rememberFindings(run, rows)
  store.close()
  return { run, written }
}

/** Read the rows a previous run wrote, so the store is not write-only. */
export const storedRemedies = (root: string, run: string): ReadonlyArray<StoredFinding> => {
  const store = createFactStore(root)
  const rows = store.findingsOf(run)
  store.close()
  return rows
}

/** A short, stable name for an input file, for the report header. */
export const describeInput = (findings: ReadonlyArray<RemedyFinding>): string => {
  const rules = new Set(findings.map((finding) => finding.rule))
  return String(findings.length) + " finding(s), " + String(rules.size) + " rule(s)"
}

/** The judgement result when no model can be reached: witness-only, and said so. */
export const witnessOnlyOpinion = (
  findings: ReadonlyArray<RemedyFinding>,
  reason: string,
): RepairOpinion => ({
  repairs: new Map(),
  same: new Map(),
  unavailable: reason,
  questions: messageNodesOf(findings).length,
  pairs: 0,
})

