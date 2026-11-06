import { Effect, Option, Order, Predicate, Schema } from "effect"
import { Decision, DecisionModel } from "effect/ai"
import { clusterOf, components, type Cluster } from "./cluster.ts"
import { inScope, type Scope } from "./rule.ts"
import { allPairs } from "./similarity.ts"
import { unitFields, type Unit, type UnitKind } from "./workspace.ts"

/**
 * One join for every candidate a rule builds, and the ranking that decides which
 * of them is worth asking about.
 *
 * Each rule used to own its generator: a shape key here, a shingle sweep there, a
 * name-family walk somewhere else. That is how a budget becomes a selection
 * rather than a bound -- forty high-scoring pairs elsewhere can spend the whole
 * allowance and leave eighteen copies of one helper unexamined -- and it is how
 * two rules end up disagreeing about what "similar" means.
 *
 * The engine is deliberately small: exact keys that are PROOFS (a shape hash, a
 * call sequence, a structural fingerprint, a value set) and speculative
 * relations that are GUESSES (shingle similarity, a shared name root). A proof is
 * never ranked and never dropped by a relevance judgement; a guess is ranked, and
 * the ranking is the one thing here that asks the model.
 */

/* -------------------------------------------------------------------------- */
/* Keys                                                                        */
/* -------------------------------------------------------------------------- */

/** The joins a candidate can be formed on. */
export type JoinKey = "shape" | "calls" | "fields" | "structure" | "values"

/**
 * The key one declaration contributes for a join, or undefined when it has none.
 *
 * `shape` includes the resolved type NAMES because two helpers that read
 * identically and reference different declared types are not the same helper.
 * `structure` is the checker's fingerprint, so it is the strongest key available
 * and the only one that can prove two differently spelled declarations equal.
 */
const keyOf = (unit: Unit, kind: JoinKey): Option.Option<string> => {
  switch (kind) {
    case "shape":
      return Option.some(
        unit.kind + "\u0000" + unit.normalizedHash + "\u0000" + unit.typeSignature,
      )
    case "calls":
      return unit.callSignature === ""
        ? Option.none()
        : Option.some(unit.kind + "\u0000" + unit.callSignature)
    case "fields": {
      const fields = [...unitFields(unit)].sort(Order.String)
      return fields.length === 0 ? Option.none() : Option.some(fields.join("\u0000"))
    }
    case "structure": {
      const facts = unit.typeFacts
      if (facts === undefined || facts.truncated) return Option.none()
      return Option.some(facts.structural)
    }
    case "values":
      return unit.values.length === 0
        ? Option.none()
        : Option.some([...unit.values].sort(Order.String).join("\u0000"))
  }
}

/** A group of declarations one join put together. */
export interface CandidateGroup {
  readonly keyKind: JoinKey
  readonly members: ReadonlyArray<Unit>
  /** True when the key is a fact about the code rather than a similarity score. */
  readonly proof: boolean
  /** The strongest deterministic signal this group carries, for ordering only. */
  readonly strength: number
}

export interface ExactOptions {
  readonly units: ReadonlyArray<Unit>
  readonly kinds: ReadonlyArray<JoinKey>
  readonly minTokens: number
  /** Declarations of one kind only: a function and an interface are not one thing. */
  readonly sameKind?: boolean | undefined
  /** True when a group must span more than one file. */
  readonly distinctFiles: boolean
  /** True when a group must contain more than one NAME. */
  readonly distinctNames?: boolean | undefined
  /** Test declarations are compared only against each other. */
  readonly separateTests?: boolean | undefined
  readonly scope: Scope
  readonly minMembers?: number | undefined
}

/**
 * Every group an exact key forms, in one pass per key.
 *
 * When a declaration has several keys it can appear in several groups, and that
 * is correct: one helper that shares a shape with one declaration and a call
 * sequence with another is two real candidates. The caller decides which join it
 * is asking about by naming the kinds.
 */
export const exactGroups = (input: ExactOptions): ReadonlyArray<CandidateGroup> => {
  const minMembers = input.minMembers === undefined ? 2 : input.minMembers
  const groups: Array<CandidateGroup> = []
  for (const keyKind of input.kinds) {
    const byKey = new Map<string, Array<Unit>>()
    for (const unit of input.units) {
      if (unit.tokens.length < input.minTokens) continue
      const key = keyOf(unit, keyKind)
      if (Option.isNone(key)) continue
      const composed = input.sameKind === true ? unit.kind + "\u0000" + key.value : key.value
      const existing = byKey.get(composed)
      if (existing === undefined) byKey.set(composed, [unit])
      else existing.push(unit)
    }
    for (const members of byKey.values()) {
      if (members.length < minMembers) continue
      if (input.distinctFiles && new Set(members.map((unit) => unit.file)).size < 2) continue
      if (input.distinctNames === true && new Set(members.map((unit) => unit.name)).size < 2) continue
      if (input.separateTests === true && members.every((unit) => unit.test)) continue
      if (!members.some((unit) => inScope(input.scope, unit.file))) continue
      groups.push({
        keyKind,
        members,
        proof: true,
        // Bigger is stronger for an exact proof: four copies are more evidence
        // than two, and the ordering only decides which groups a budget keeps.
        strength: Math.min(1, members.length / 10),
      })
    }
  }
  return groups.sort(
    (left, right) =>
      right.members.length - left.members.length ||
      (left.members[0]?.name ?? "").localeCompare(right.members[0]?.name ?? ""),
  )
}

/* -------------------------------------------------------------------------- */
/* Similarity (speculative)                                                    */
/* -------------------------------------------------------------------------- */

export interface SimilarOptions {
  readonly units: ReadonlyArray<Unit>
  readonly minTokens: number
  readonly minSimilarity: number
  readonly maxSimilarity: number
  readonly kinds: ReadonlyArray<UnitKind> | undefined
  readonly scope: Scope
  /** Test declarations are compared only against each other. */
  readonly separateTests?: boolean | undefined
}

export interface UnitPair {
  readonly left: Unit
  readonly right: Unit
  readonly score: number
}

/**
 * Structurally close pairs, from the shingle sweep.
 *
 * Complete up to the provable length filter in {@link allPairs}: no qualifying
 * pair is missed, so a budget is spent on judgement rather than on selection.
 * The caller turns pairs into clusters; similarity is not transitive, so a
 * cluster is a clique and that is the caller's invariant, not this one's.
 */
export const similarPairs = (input: SimilarOptions): ReadonlyArray<UnitPair> => {
  const eligible: Array<{ unit: Unit; index: number }> = []
  input.units.forEach((unit, index) => {
    if (unit.tokens.length < input.minTokens) return
    if (input.kinds !== undefined && !input.kinds.includes(unit.kind)) return
    eligible.push({ unit, index })
  })
  const pairs = allPairs(
    eligible.map((entry) => ({ position: entry.index, shingles: entry.unit.shingles })),
    input.minSimilarity,
  )
  const found: Array<UnitPair> = []
  for (const pair of pairs) {
    const left = input.units[pair.left]
    const right = input.units[pair.right]
    if (left === undefined || right === undefined) continue
    if (pair.score > input.maxSimilarity) continue
    if (left.file === right.file || left.kind !== right.kind) continue
    if (input.separateTests === true && left.test && right.test) continue
    if (!inScope(input.scope, left.file) && !inScope(input.scope, right.file)) continue
    found.push({ left, right, score: pair.score })
  }
  return found
}

/**
 * Cliques from a pair set: every member similar to every other.
 *
 * Union-find over a non-transitive relation does not produce concepts. One
 * repository produced "105 declarations that may be one thing: down" -- every
 * migration's `down` function differing from its neighbours by a table name, so
 * the chain closed around all of them. A clique is the condition that makes
 * "these N are one thing" a question rather than a path through a graph.
 */
export interface ClusteredPairs {
  readonly clusters: ReadonlyArray<Cluster>
  /** Members that resembled a neighbour without resembling every member. */
  readonly chained: number
}

/**
 * Turn a pair set into cliques, one cluster per clique.
 *
 * @param input.units - the declarations the pairs refer to.
 * @param input.pairs - the pairs, already filtered.
 * @param input.separateTests - true to drop a cluster that is test code only.
 * @returns the clusters, and how many members a chain left out.
 */
export const similarClusters = (input: {
  readonly units: ReadonlyArray<Unit>
  readonly pairs: ReadonlyArray<UnitPair>
  readonly separateTests?: boolean | undefined
}): ClusteredPairs => {
  const positionOf = new Map<Unit, number>()
  input.units.forEach((unit, index) => positionOf.set(unit, index))
  const scoreOf = new Map<string, number>()
  const adjacency = new Map<number, Set<number>>()
  const link = (from: number, to: number): void => {
    const existing = adjacency.get(from)
    if (existing === undefined) adjacency.set(from, new Set([to]))
    else existing.add(to)
  }
  const edges: Array<readonly [number, number]> = []
  for (const pair of input.pairs) {
    const left = positionOf.get(pair.left)
    const right = positionOf.get(pair.right)
    if (left === undefined || right === undefined) continue
    scoreOf.set(left + ":" + right, pair.score)
    scoreOf.set(right + ":" + left, pair.score)
    link(left, right)
    link(right, left)
    edges.push([left, right])
  }
  const adjacent = (one: number, other: number): boolean =>
    adjacency.get(one)?.has(other) === true

  const clusters: Array<Cluster> = []
  let chained = 0
  for (const group of components(input.units.length, edges)) {
    if (group.length < 2) continue
    const ordered = [...group].sort(
      (left, right) => (adjacency.get(right)?.size ?? 0) - (adjacency.get(left)?.size ?? 0),
    )
    const clique: Array<number> = []
    for (const index of ordered) {
      if (clique.every((member) => adjacent(index, member))) clique.push(index)
    }
    chained += group.length - clique.length
    if (clique.length < 2) continue
    const members = clique
      .map((index) => input.units[index])
      .filter((unit): unit is Unit => unit !== undefined)
    if (members.length < 2) continue
    if (input.separateTests === true && members.every((unit) => unit.test)) continue
    let overlap = 0
    for (let a = 0; a < clique.length; a += 1) {
      for (let b = a + 1; b < clique.length; b += 1) {
        const left = clique[a]
        const right = clique[b]
        if (left === undefined || right === undefined) continue
        const score = scoreOf.get(left + ":" + right) ?? 0
        if (score > overlap) overlap = score
      }
    }
    clusters.push(clusterOf(members, false, overlap))
  }
  return { clusters, chained }
}

/* -------------------------------------------------------------------------- */
/* Names                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The words a name is made of.
 *
 * Split on case and separators, lowercased. The SHAPE of a name, not its
 * meaning, which is why this is a lexical helper and not a classifier.
 */
export const words = (name: string): ReadonlyArray<string> =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0)

/**
 * Abbreviations expanded before two names are compared.
 *
 * The one hand-written table in the join, and it exists so the judgement sees
 * `orgId` and `organizationId` as the same phrase rather than as two strings.
 */
const abbreviations = {
  arg: "argument",
  auth: "authentication",
  cfg: "configuration",
  config: "configuration",
  ctx: "context",
  db: "database",
  dir: "directory",
  doc: "document",
  env: "environment",
  err: "error",
  fn: "function",
  id: "identifier",
  idx: "index",
  img: "image",
  impl: "implementation",
  info: "information",
  init: "initialize",
  msg: "message",
  nav: "navigation",
  num: "number",
  org: "organization",
  param: "parameter",
  prev: "previous",
  repo: "repository",
  req: "request",
  res: "response",
  spec: "specification",
  src: "source",
  stat: "statistic",
  str: "string",
  temp: "temporary",
  tmp: "temporary",
  util: "utility",
  utils: "utility",
} satisfies Record<string, string>

/** The same table, by word, so a lookup does not need an index signature. */
const ABBREVIATIONS: ReadonlyMap<string, string> = new Map(Object.entries(abbreviations))

/** Split a name into words and expand the abbreviations in the table. */
export const expanded = (name: string): ReadonlyArray<string> =>
  words(name).map((word) => ABBREVIATIONS.get(word) ?? word)

/**
 * Jaccard over expanded words.
 *
 * @param input.one - the first name.
 * @param input.two - the second name.
 * @returns the overlap on [0, 1]; 0 when either name has no words.
 */
export const nameScore = (input: { readonly one: string; readonly two: string }): number => {
  const left = new Set(expanded(input.one))
  const right = new Set(expanded(input.two))
  let intersection = 0
  for (const word of left) if (right.has(word)) intersection += 1
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Whether a pair of names is worth asking about.
 *
 * The whole difference between a rule that costs money and one that spends it.
 * Identical expanded words always qualify (the spellings differ and nothing
 * else); a name nested in the other by exactly one word qualifies, because
 * whether that word carries meaning is the question the rule exists to ask.
 */
export const worthJudging: Predicate.Predicate<{
  readonly one: string
  readonly two: string
}> = (pair) => {
  if (pair.one === pair.two) return false
  const first = new Set(expanded(pair.one))
  const second = new Set(expanded(pair.two))
  let common = 0
  for (const word of first) if (second.has(word)) common += 1
  const differs = first.size - common + (second.size - common)
  if (differs === 0) return true
  const nested = common === first.size || common === second.size
  return nested && differs === 1
}

/**
 * Words two names have in common, after expansion.
 *
 * @param input.one - the first name.
 * @param input.two - the second name.
 * @returns the count of shared words.
 */
export const sharedWords = (input: { readonly one: string; readonly two: string }): number => {
  const first = new Set(expanded(input.one))
  let shared = 0
  for (const word of new Set(expanded(input.two))) if (first.has(word)) shared += 1
  return shared
}

export interface NameOptions {
  readonly units: ReadonlyArray<Unit>
  readonly minScore: number
  readonly minSharedWords: number
  readonly scope: Scope
  /** Exported names only: an agent greps an exported name first. */
  readonly exportedOnly: boolean
}

/**
 * Pairs of exported names in the same head-noun family, one pair per question.
 *
 * There is no clustering: "is this name another spelling of that one" is a
 * question about two things, and union-find over it chained every `*Modal` into
 * one eighty-seven member "concept".
 */
export const namePairs = (input: NameOptions): ReadonlyArray<UnitPair> => {
  const byHead = new Map<string, Array<Unit>>()
  for (const unit of input.units) {
    if (input.exportedOnly && !unit.exported) continue
    const head = expanded(unit.name).at(-1)
    if (head === undefined) continue
    const existing = byHead.get(head)
    if (existing === undefined) byHead.set(head, [unit])
    else existing.push(unit)
  }
  const found: Array<UnitPair> = []
  for (const family of byHead.values()) {
    for (let a = 0; a < family.length; a += 1) {
      for (let b = a + 1; b < family.length; b += 1) {
        const one = family[a]
        const two = family[b]
        if (one === undefined || two === undefined) continue
        if (one.name === two.name || one.file === two.file || one.kind !== two.kind) continue
        if (one.test && two.test) continue
        if (sharedWords({ one: one.name, two: two.name }) < input.minSharedWords) continue
        if (!inScope(input.scope, one.file) && !inScope(input.scope, two.file)) continue
        const score = nameScore({ one: one.name, two: two.name })
        if (score < input.minScore) continue
        if (!worthJudging({ one: one.name, two: two.name })) continue
        found.push({ left: one, right: two, score })
      }
    }
  }
  return found.sort(
    (left, right) =>
      right.score - left.score ||
      left.left.name.localeCompare(right.left.name) ||
      left.right.name.localeCompare(right.right.name),
  )
}

/* -------------------------------------------------------------------------- */
/* Field sets                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Field groups that repeat without a name.
 *
 * Pair co-occurrence, then the intersection of the declarations that carry a
 * pair, gives GROUPS without mining every subset of every declaration. The
 * result is a group of field names and the declarations that contain all of
 * them, which is exactly what `name-the-primitive` asks about.
 */
export const fieldGroups = (input: {
  readonly units: ReadonlyArray<Unit>
  readonly minFields: number
  readonly minOccurrences: number
  readonly scope: Scope
}): ReadonlyArray<{ readonly units: ReadonlyArray<Unit>; readonly fields: ReadonlyArray<string> }> => {
  const signatureOf = (fields: ReadonlyArray<string>): string =>
    [...fields].sort(Order.String).join("\u0000")
  const named = new Set(input.units.map((unit) => signatureOf(unitFields(unit))))
  const pairOccurrences = new Map<string, Array<Unit>>()
  for (const unit of input.units) {
    const fields = [...new Set(unitFields(unit))]
    for (let a = 0; a < fields.length; a += 1) {
      for (let b = a + 1; b < fields.length; b += 1) {
        const left = fields[a]
        const right = fields[b]
        if (left === undefined || right === undefined) continue
        const key = signatureOf([left, right])
        const existing = pairOccurrences.get(key)
        if (existing === undefined) pairOccurrences.set(key, [unit])
        else existing.push(unit)
      }
    }
  }
  const considered = [...pairOccurrences.entries()]
    .filter(([, units]) => units.length >= input.minOccurrences)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))

  const groups: Array<{ units: ReadonlyArray<Unit>; fields: ReadonlyArray<string> }> = []
  for (const [, units] of considered) {
    const first = units[0]
    if (first === undefined) continue
    let group = new Set(unitFields(first))
    for (const unit of units) {
      const fields = new Set(unitFields(unit))
      group = new Set([...group].filter((field) => fields.has(field)))
    }
    if (group.size < input.minFields) continue
    if (named.has(signatureOf([...group]))) continue
    groups.push({ units, fields: [...group].sort(Order.String) })
  }
  groups.sort(
    (left, right) =>
      right.fields.length - left.fields.length ||
      right.units.length - left.units.length ||
      left.fields.join(",").localeCompare(right.fields.join(",")),
  )

  // A group already contained in a larger reported group is the same finding
  // twice: `{id, project}` beside the five-field group that contains it.
  const kept: Array<ReadonlyArray<string>> = []
  const candidates: Array<{ units: ReadonlyArray<Unit>; fields: ReadonlyArray<string> }> = []
  for (const entry of groups) {
    const first = entry.units[0]
    if (first === undefined) continue
    if (!inScope(input.scope, first.file)) continue
    if (kept.some((seen) => entry.fields.every((field) => seen.includes(field)))) continue
    kept.push(entry.fields)
    candidates.push(entry)
  }
  return candidates
}

/** A type that repeats every field of another type and adds some of its own. */
export interface Containment {
  readonly whole: Unit
  readonly part: Unit
  readonly added: ReadonlyArray<string>
}

/**
 * Containment pairs: one declaration's field set is a proper subset of another's.
 *
 * Field-NAME containment is the fact. Whether the two are genuinely one type
 * composed of another is the question, and the word-subset test that used to
 * live here decided a type question in code.
 */
export const containmentPairs = (input: {
  readonly units: ReadonlyArray<Unit>
  readonly kinds: ReadonlyArray<UnitKind>
  readonly minFields: number
  readonly maxTypes: number
  readonly scope: Scope
}): ReadonlyArray<Containment> => {
  const all = input.units.filter(
    (unit) => input.kinds.includes(unit.kind) && unitFields(unit).length >= input.minFields,
  )
  const bounded = all.slice(0, input.maxTypes)
  const signatureOf = (unit: Unit): string => [...unitFields(unit)].sort(Order.String).join("\u0000")
  const parts = new Map<string, Unit>()
  for (const unit of bounded) {
    const signature = signatureOf(unit)
    if (!parts.has(signature)) parts.set(signature, unit)
  }
  const candidates: Array<Containment> = []
  for (const whole of bounded) {
    if (!inScope(input.scope, whole.file)) continue
    const wholeFields = new Set(unitFields(whole))
    let best: Unit | undefined
    for (const part of parts.values()) {
      if (unitFields(part).length >= unitFields(whole).length) continue
      if (best !== undefined && unitFields(part).length <= unitFields(best).length) continue
      if (unitFields(whole).length - unitFields(part).length > unitFields(part).length) continue
      const contained = unitFields(part).every((field) => wholeFields.has(field))
      if (contained) best = part
    }
    if (best === undefined) continue
    candidates.push({
      whole,
      part: best,
      added: unitFields(whole).filter((field) => !unitFields(best).includes(field)),
    })
  }
  return candidates
}

/* -------------------------------------------------------------------------- */
/* Ranking (the one judgement)                                                 */
/* -------------------------------------------------------------------------- */

/** What the ranker sees about one speculative candidate. Bounded by construction. */
export const RankEvidence = Schema.Struct({
  names: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  signal: Schema.String,
})

export type RankEvidence = typeof RankEvidence.Type

export interface Speculative<T> {
  readonly item: T
  readonly evidence: RankEvidence
  /** Deterministic strength in [0, 1], used to order before the judgement. */
  readonly strength: number
}

const RankInput = Schema.Struct({
  candidates: Schema.Array(RankEvidence),
})

const RANK_INSTRUCTIONS = [
  "Each entry of `candidates` is a pair or group of declarations a mechanical join put together.",
  "Answer whether a reader who is fixing one of them would need to look at the others: does comparing them change what someone would do?",
  "Answer true when they could be one concept written twice, or two spellings of one name.",
  "Answer false when they are unrelated declarations that only scored alike: different purposes, a generic utility, a test fixture beside the code it tests.",
].join("\n")

/**
 * Reorder speculative candidates by one relevance judgement, in one request.
 *
 * Only ever called with GUESSES. A proof -- identical shape, identical resolved
 * type, identical call sequence -- is never passed through here, because a
 * relevance answer cannot overrule the compiler.
 *
 * The deterministic strength orders the candidates BEFORE the request and bounds
 * the window the model sees: a thousand name pairs are trimmed to twice the
 * budget so the request stays inside the provider's ceiling, and the judgement
 * decides which half of that window is worth it. Everything beyond the window
 * keeps its deterministic order and stays named in the caller's note.
 *
 * @param input.items - the candidates, in deterministic order.
 * @param input.budget - how many the caller will judge.
 * @returns every item, reordered: the judged window first by probability, then the rest.
 */
export const rankSpeculative = <T>(input: {
  readonly items: ReadonlyArray<Speculative<T>>
  readonly budget: number
}): Effect.Effect<ReadonlyArray<T>, never, DecisionModel.DecisionModel> => {
  const ordered = [...input.items].sort(
    (left, right) =>
      right.strength - left.strength ||
      (left.evidence.names[0] ?? "").localeCompare(right.evidence.names[0] ?? ""),
  )
  if (ordered.length <= input.budget) return Effect.succeed(ordered.map((entry) => entry.item))
  const window = ordered.slice(0, Math.max(input.budget, input.budget * 2))
  const rest = ordered.slice(window.length)

  const decide = Effect.gen(function* () {
    const decisions: Record<string, Decision.Any> = {}
    window.forEach((_entry, index) => {
      decisions["keep_" + String(index)] = Decision.probability({
        instructions: RANK_INSTRUCTIONS,
        criteria: {
          false: "Unrelated. Comparing them would not change what someone does.",
          true: "Worth comparing. They may be one concept or one name spelled twice.",
        },
      })
    })
    const definition = Decision.make({
      input: RankInput,
      decisions,
    })
    const decided = yield* DecisionModel.decide(definition, {
      input: { candidates: window.map((entry) => entry.evidence) },
    })
    const scored = window.map((entry, index) => {
      const answer = decided.answers["keep_" + String(index)]
      const probability =
        answer !== undefined && "probability" in answer ? answer.probability : 0
      return { entry, probability }
    })
    scored.sort(
      (left, right) =>
        right.probability - left.probability ||
        right.entry.strength - left.entry.strength ||
        (left.entry.evidence.names[0] ?? "").localeCompare(right.entry.evidence.names[0] ?? ""),
    )
    return [...scored.map((entry) => entry.entry.item), ...rest.map((entry) => entry.item)]
  })

  // A ranker that cannot answer is not a reason to lose the rule: the
  // deterministic order is already the fallback, and the caller's note still says
  // how many were not judged. Swallowing every failure is deliberate -- the
  // question only reorders a budget, so a broken model costs ordering, not a
  // candidate.
  return decide.pipe(
    Effect.orElseSucceed(() => [
      ...window.map((entry) => entry.item),
      ...rest.map((entry) => entry.item),
    ]),
  )
}

/**
 * A deterministic strength for a pair, from the evidence a join already has.
 *
 * Used only to order the window the ranker sees; it never decides a finding.
 */
export const strengthOf = (input: {
  readonly score: number
  readonly members: number
}): number => Math.min(1, input.score + Math.min(0.2, input.members / 50))
