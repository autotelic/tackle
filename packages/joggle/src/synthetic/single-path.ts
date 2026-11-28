import { atomId } from "../atoms.ts"
import { canonical } from "../canonical.ts"
import { verdictQuestion } from "../rules/single-path.ts"
import { shortHash } from "../state.ts"

/*
 * A synthetic corpus for `joggle/single-path`, and the predicate that labels it.
 *
 * The rule asks one binary question -- does one of the listed helpers build the
 * value this site builds -- and its truth is executable: either the helper
 * covers the call site or it does not. So the corpus does not need a model to
 * label it, and no label here is a person's opinion.
 *
 * Three families, in the rule's own vocabulary:
 *
 *   reimplements       the helper performs what the site performs
 *   legitimate_local   the site's body differs in a way that changes the value
 *   near_miss          the same call shape, and the helper still does not cover it
 *
 * `near_miss` is the adversarial negative. A model that pattern-matches on shape
 * -- `"$" + x.toFixed(2)` on both sides -- answers `reimplements`; the predicate
 * answers `legitimate_local`, because it evaluates both bodies and one of them
 * takes `Math.abs` first. A code-verified label is what makes that
difference visible without asking a model which of the two it sees.
 *
 * The state carries only what the rule's question reads: the site and its
 * helpers. The label lives beside the state, never inside it.
 */

/** The two labels the corpus offers. */
export type SinglePathLabel = "reimplements" | "legitimate_local"

/**
 * Which recipe produced an item. `reimplements` and `legitimate_local` are also
 * labels; `near_miss` is a legitimate-local site built to look reimplemented.
 */
export type SinglePathFamily = SinglePathLabel | "near_miss"

/** The site a rule would see: which unit builds the string, and its source. */
export type SyntheticSite = {
  readonly unit: string
  readonly file: string
  readonly refs: ReadonlyArray<string>
  readonly source: string
}

/** A helper the file already calls, with its body, as the rule sends it. */
export type SyntheticHelper = {
  readonly name: string
  readonly file: string
  readonly body: string
}

/** One atom: the site and the helpers offered against it. */
export type SyntheticAtom = {
  readonly site: SyntheticSite
  readonly helpers: ReadonlyArray<SyntheticHelper>
}

/**
 * The state a question is asked against. It is the atom map and nothing else:
 * a field naming the answer here would make the corpus a lookup, not a test.
 */
export type SinglePathState = {
  readonly atoms: Readonly<Record<string, SyntheticAtom>>
}

/** The rule's question, copied from the rule rather than restated. */
export type SyntheticQuestion = {
  readonly ruleId: "joggle/single-path"
  readonly decisionId: "verdict"
  readonly kind: "Classify"
  readonly labelSet: ReadonlyArray<SinglePathLabel>
  readonly instructions: string
  readonly criteria: Readonly<Record<string, string>>
}

/** Where an item came from, and what the predicate did to label it. */
export type SyntheticProvenance = {
  readonly generator: "single-path"
  readonly generatorVersion: string
  readonly predicateId: "single-path.v1"
  readonly predicateVersion: string
  readonly source: "synthetic"
  readonly truth: string
  readonly family: SinglePathFamily
}

/** One line of the corpus: a question, the state, its code-verified label. */
export type SyntheticItem = {
  readonly question: SyntheticQuestion
  readonly state: SinglePathState
  readonly label: SinglePathLabel
  readonly provenance: SyntheticProvenance
}

/** What the predicate concluded, and the sentence describing what it ran. */
export type TruthOutcome = {
  readonly label: SinglePathLabel
  readonly executed: string
}

/** The counts a manifest records, one per generated family. */
export type CorpusCounts = {
  readonly reimplements: number
  readonly legitimate_local: number
  readonly near_miss: number
}

/** The committed record of one corpus emission. */
export type CorpusManifest = {
  readonly corpusHash: string
  readonly seed: number
  readonly generatorVersion: string
  readonly predicateVersion: string
  readonly counts: CorpusCounts
  readonly predicateFailures: number
  readonly duplicates: number
}

/** The rule whose question this corpus asks. */
export const SINGLE_PATH_RULE_ID = "joggle/single-path"
/** The generator's version: bumping it retires every committed corpus. */
export const GENERATOR_VERSION = "1"
/** The predicate's name, recorded on every item so a label can be re-derived. */
export const PREDICATE_ID = "single-path.v1"
/** The predicate's version: a changed probe set or evaluator is a new predicate. */
export const PREDICATE_VERSION = "1"

/**
 * The inputs both bodies are evaluated on.
 *
 * Chosen for the edges a formatter gets wrong: negatives (a helper that takes
 * `Math.abs` first), halves (a helper that rounds where the site formats), and
 * values whose decimal part does not survive a binary float (a precision the
 * site and the helper disagree about). Two bodies agreeing on all of them is the
 * predicate's evidence, so the set is part of the predicate's identity.
 */
const PROBES: ReadonlyArray<number> = [
  -1234.5678,
  -2.5,
  -0.5,
  -0.005,
  0,
  0.005,
  0.125,
  1.005,
  2.5,
  12.345,
  999.999,
  1234567.891,
]

/** The site files a generated atom names. */
const SITE_FILES: readonly [string, ...ReadonlyArray<string>] = [
  "src/receipt.ts",
  "src/invoice.ts",
  "src/statement.ts",
  "src/summary.ts",
  "src/balance.ts",
]
/** The units that build the string at the site. */
const UNITS: readonly [string, ...ReadonlyArray<string>] = [
  "renderReceipt",
  "renderInvoice",
  "summariseTotals",
  "printStatement",
  "renderSummary",
  "showBalance",
]
/** The files the helpers already live in. */
const HELPER_FILES: readonly [string, ...ReadonlyArray<string>] = [
  "src/money.ts",
  "src/format.ts",
  "src/amounts.ts",
  "src/currency.ts",
]
/** The helper names a generated atom offers. */
const HELPER_NAMES: readonly [string, ...ReadonlyArray<string>] = [
  "formatAmount",
  "displayTotal",
  "formatMoney",
  "renderAmount",
]
/** The literal a formatted amount is prefixed with. */
const PREFIXES: readonly [string, ...ReadonlyArray<string>] = [
  '"\u0024"',
  '"\u20ac"',
  '"\u00a3"',
  '"USD "',
  '"CHF "',
]
/** The literal it is suffixed with; `""` keeps the concat without adding text. */
const SUFFIXES: readonly [string, ...ReadonlyArray<string>] = [
  '""',
  '" USD"',
  '" EUR"',
  '"%"',
  '" net"',
]
/** The decimal places a formatter chooses. */
const PRECISIONS: readonly [number, ...ReadonlyArray<number>] = [0, 1, 2, 3]
/** The numeric form a formatter applies before it formats. */
const FORMS: readonly [string, ...ReadonlyArray<string>] = ["plain", "rounded", "absolute"]
/** Whitespace, which changes the bytes without changing the value. */
const LAYOUTS: readonly [string, ...ReadonlyArray<string>] = ["tight", "spaced"]
/** A redundant pair of parentheses, also value-preserving. */
const WRAPS: readonly [string, ...ReadonlyArray<string>] = ["bare", "wrapped"]
/** A redundant pair of parentheses around the input. */
const INPUTS: readonly [string, ...ReadonlyArray<string>] = ["value", "(value)"]
/** A step around the precision cycle, never zero. */
const STEPS: readonly [number, ...ReadonlyArray<number>] = [0, 1, 2]
/** The coarse dimensions a legitimate local site differs along. */
const DIMENSIONS: readonly [string, ...ReadonlyArray<string>] = [
  "digits",
  "prefix",
  "suffix",
  "form",
]

/** One side of the comparison: what a body renders, before cosmetic layout. */
type Side = {
  readonly form: string
  readonly digits: number
  readonly prefix: string
  readonly suffix: string
  readonly input: string
}

/** One value an expression evaluates to. Tagged, so narrowing never needs `typeof`. */
type Value =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }

/** One token of a generated expression. */
type Token =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "name"; readonly value: string }
  | { readonly kind: "punct"; readonly value: string }

/**
 * Evaluate one generated expression on one input, or nothing when it cannot be
 * evaluated at all.
 *
 * A hand-written evaluator rather than `eval` or `new Function`: the states are
 * generated, their grammar is this file's, and a corpus tool must not gain the
 * ability to execute arbitrary source because a file asked it to. The grammar is
 * the intersection of what the generator emits -- string and number literals,
 * `value`, `+ * / -`, parentheses, `Math.round`/`Math.abs`, and the member calls
 * on a number or a string that a formatter uses.
 *
 * @param request - the expression source, and the numeric input bound to `value`.
 * @returns the value, or `undefined` when the source is not a well-formed
 *   expression of this grammar or a call is applied to the wrong type.
 */
const evaluateSource = ({
  source,
  probe,
}: {
  readonly source: string
  readonly probe: number
}): Value | undefined => {
  const tokens: Array<Token> = []
  let index = 0
  while (index < source.length) {
    const char = source[index] ?? ""
    if (char === " " || char === "\n" || char === "\t") {
      index += 1
      continue
    }
    if (char === '"') {
      const end = source.indexOf('"', index + 1)
      if (end === -1) return undefined
      tokens.push({ kind: "string", value: source.slice(index + 1, end) })
      index = end + 1
      continue
    }
    if (char >= "0" && char <= "9") {
      let end = index
      while (end < source.length && /[0-9.]/u.test(source[end] ?? "")) end += 1
      const value = Number(source.slice(index, end))
      if (!Number.isFinite(value)) return undefined
      tokens.push({ kind: "number", value })
      index = end
      continue
    }
    if (/[A-Za-z_]/u.test(char)) {
      let end = index
      while (end < source.length && /[A-Za-z0-9_]/u.test(source[end] ?? "")) end += 1
      tokens.push({ kind: "name", value: source.slice(index, end) })
      index = end
      continue
    }
    tokens.push({ kind: "punct", value: char })
    index += 1
  }

  let cursor = 0

  const peek = (): Token | undefined => tokens[cursor]

  const take = (value: string): boolean => {
    const token = tokens[cursor]
    if (token === undefined || token.kind !== "punct" || token.value !== value) return false
    cursor += 1
    return true
  }

  const parseExpression = (): Value | undefined => {
    let left = parseTerm()
    if (left === undefined) return undefined
    let next = peek()
    while (
      next !== undefined && next.kind === "punct" && (next.value === "+" || next.value === "-")
    ) {
      const operator = next.value
      cursor += 1
      const right = parseTerm()
      if (right === undefined) return undefined
      const folded = fold(operator, left, right)
      if (folded === undefined) return undefined
      left = folded
      next = peek()
    }
    return left
  }

  const fold = (operator: string, left: Value, right: Value): Value | undefined => {
    if (operator === "+" && (left.kind === "string" || right.kind === "string")) {
      const asText = left.kind === "string" ? left.value : String(left.value)
      const other = right.kind === "string" ? right.value : String(right.value)
      return { kind: "string", value: asText + other }
    }
    if (left.kind !== "number" || right.kind !== "number") return undefined
    if (operator === "+") return { kind: "number", value: left.value + right.value }
    if (operator === "-") return { kind: "number", value: left.value - right.value }
    if (operator === "*") return { kind: "number", value: left.value * right.value }
    if (operator === "/") return { kind: "number", value: left.value / right.value }
    return undefined
  }

  const parseTerm = (): Value | undefined => {
    let left = parseUnary()
    if (left === undefined) return undefined
    let next = peek()
    while (
      next !== undefined && next.kind === "punct" && (next.value === "*" || next.value === "/")
    ) {
      const operator = next.value
      cursor += 1
      const right = parseUnary()
      if (right === undefined) return undefined
      if (left.kind !== "number" || right.kind !== "number") return undefined
      left = {
        kind: "number",
        value: operator === "*" ? left.value * right.value : left.value / right.value,
      }
      next = peek()
    }
    return left
  }

  const parseUnary = (): Value | undefined => {
    const token = peek()
    if (token !== undefined && token.kind === "punct" && token.value === "-") {
      cursor += 1
      const inner = parseUnary()
      if (inner === undefined || inner.kind !== "number") return undefined
      return { kind: "number", value: -inner.value }
    }
    return parseMember()
  }

  const parseMember = (): Value | undefined => {
    let base = parsePrimary()
    if (base === undefined) return undefined
    let next = peek()
    while (next !== undefined && next.kind === "punct" && next.value === ".") {
      cursor += 1
      const method = tokens[cursor]
      if (method === undefined || method.kind !== "name") return undefined
      cursor += 1
      if (!take("(")) return undefined
      const argument = method.value === "toUpperCase" || method.value === "toLowerCase" ||
          method.value === "trim"
        ? undefined
        : parseExpression()
      if (!take(")")) return undefined
      base = call(base, method.value, argument)
      if (base === undefined) return undefined
      next = peek()
    }
    return base
  }

  const call = (base: Value, method: string, argument: Value | undefined): Value | undefined => {
    if (base.kind === "number") {
      if (method === "toString" && argument === undefined) {
        return { kind: "string", value: String(base.value) }
      }
      if (method === "toFixed" && argument !== undefined && argument.kind === "number") {
        return { kind: "string", value: base.value.toFixed(argument.value) }
      }
      return undefined
    }
    if (argument !== undefined) return undefined
    if (method === "toUpperCase") return { kind: "string", value: base.value.toUpperCase() }
    if (method === "toLowerCase") return { kind: "string", value: base.value.toLowerCase() }
    if (method === "trim") return { kind: "string", value: base.value.trim() }
    return undefined
  }

  const parsePrimary = (): Value | undefined => {
    const token = peek()
    if (token === undefined) return undefined
    if (token.kind === "number" || token.kind === "string") {
      cursor += 1
      if (token.kind === "number") return { kind: "number", value: token.value }
      return { kind: "string", value: token.value }
    }
    if (token.kind === "punct" && token.value === "(") {
      cursor += 1
      const inner = parseExpression()
      if (inner === undefined) return undefined
      return take(")") ? inner : undefined
    }
    if (token.kind === "name" && token.value === "value") {
      cursor += 1
      return { kind: "number", value: probe }
    }
    if (token.kind === "name" && token.value === "Math") {
      cursor += 1
      if (!take(".")) return undefined
      const method = tokens[cursor]
      if (method === undefined || method.kind !== "name") return undefined
      cursor += 1
      if (!take("(")) return undefined
      const argument = parseExpression()
      if (argument === undefined || argument.kind !== "number") return undefined
      if (!take(")")) return undefined
      if (method.value === "round") return { kind: "number", value: Math.round(argument.value) }
      if (method.value === "abs") return { kind: "number", value: Math.abs(argument.value) }
      return undefined
    }
    return undefined
  }

  const parsed = parseExpression()
  if (parsed === undefined || cursor !== tokens.length) return undefined
  return parsed
}

/**
 * The expression a helper body returns, or nothing when it has none.
 *
 * The generator writes one shape -- a `return` statement inside a function --
 * and this reads that shape rather than parsing a function.
 *
 * @param body - the helper body as the atom carries it.
 * @returns the returned expression's source.
 */
const returnedExpression = (body: string): string | undefined => {
  const start = body.indexOf("return")
  if (start === -1) return undefined
  let expression = body.slice(start + "return".length).trim()
  if (expression.endsWith("}")) expression = expression.slice(0, -1).trim()
  if (expression.endsWith(";")) expression = expression.slice(0, -1).trim()
  return expression === "" ? undefined : expression
}

/**
 * Re-derive an item's label from its state alone.
 *
 * Every helper body is evaluated against the site's body on `PROBES`: a helper
 * that produces the same value on every one of them covers the site, so the
 * inline string re-implements a path the file already has. Nothing else is
 * consulted -- no name, no field, no family -- which is what makes the label
 * checkable rather than asserted.
 *
 * `executed` records what ran, so an item can say where its label came from.
 *
 * @param state - the atom map the question was asked against.
 * @returns the label, and the sentence describing the evaluation behind it.
 */
export const evaluate = (state: SinglePathState): TruthOutcome => {
  const agreement = (site: string, expression: string): number => {
    let agreed = 0
    for (const probe of PROBES) {
      const left = evaluateSource({ source: site, probe })
      const right = evaluateSource({ source: expression, probe })
      if (left === undefined || right === undefined) continue
      if (left.kind === "number" && right.kind === "number" && left.value === right.value) {
        agreed += 1
        continue
      }
      if (left.kind === "string" && right.kind === "string" && left.value === right.value) {
        agreed += 1
      }
    }
    return agreed
  }

  let helpers = 0
  let best = 0
  let covered = false
  for (const atom of Object.values(state.atoms)) {
    for (const helper of atom.helpers) {
      helpers += 1
      const expression = returnedExpression(helper.body)
      if (expression === undefined) continue
      const agreed = agreement(atom.site.source, expression)
      if (agreed > best) best = agreed
      if (agreed === PROBES.length) covered = true
    }
  }
  return {
    label: covered ? "reimplements" : "legitimate_local",
    executed:
      "evaluated " +
      String(helpers) +
      " helper body/ies against the site on " +
      String(PROBES.length) +
      " probe input(s); best agreement " +
      String(best) +
      "/" +
      String(PROBES.length),
  }
}

/**
 * The label, re-derived from the state.
 *
 * @param state - the atom map the question was asked against.
 * @returns `reimplements` when a helper covers the site, `legitimate_local` otherwise.
 */
export const truth = (state: SinglePathState): SinglePathLabel => evaluate(state).label

/**
 * Generate a corpus, deterministically, from a seed and a count.
 *
 * The label is `truth`'s answer, never a family's intent: the three families
 * only choose which recipe builds a state, and a recipe that failed to build the
 * state it meant to would be a mislabelled item, not a mislabelled predicate.
 *
 * @param request - the PRNG seed and how many items to emit.
 * @returns the items, label-balanced within one item.
 */
export const generate = ({
  seed,
  count,
}: {
  readonly seed: number
  readonly count: number
}): ReadonlyArray<SyntheticItem> => {
  // mulberry32: 32 bits of state, no Date, no Math.random, no I/O. The corpus is
  // a function of (seed, count) so two machines produce the same bytes.
  let state = seed >>> 0
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }

  const pick = <T>(values: readonly [T, ...ReadonlyArray<T>]): T =>
    values[Math.floor(random() * values.length)] ?? values[0]

  const besides = <T>(values: readonly [T, ...ReadonlyArray<T>], current: T): T => {
    const next = pick(values)
    return next === current ? (values.find((value) => value !== current) ?? next) : next
  }

  const coreOf = (side: Side, input: string): string => {
    if (side.form === "rounded") return `Math.round(${input}).toFixed(${side.digits})`
    if (side.form === "absolute") return `Math.abs(${input}).toFixed(${side.digits})`
    return `${input}.toFixed(${side.digits})`
  }

  const render = (side: Side, layout: string, wrap: string, inputStyle: string): string => {
    // The cosmetic parenthesis wraps the input TERM, so it decorates a near
    // miss' different operand instead of replacing it.
    const input = inputStyle === "wrapped" ? `(${side.input})` : side.input
    const glue = layout === "spaced" ? " + " : "+"
    const joined = side.prefix + glue + coreOf(side, input) + glue + side.suffix
    return wrap === "wrapped" ? `(${joined})` : joined
  }

  // The input terms that keep the call shape and change the value. `Math.round`
  // is not offered against a shape that already rounds, because rounding twice
  // is the identity and the item would not be a near miss at all.
  const nearMissInputs = (form: string): readonly [string, ...ReadonlyArray<string>] => {
    if (form === "rounded") return ["Math.abs(value)", "(value * 100)"]
    if (form === "absolute") return ["(value * 100)", "Math.round(value)"]
    return ["Math.abs(value)", "(value * 100)", "Math.round(value)"]
  }

  const build = (family: SinglePathFamily): SyntheticItem => {
    const prefix = pick(PREFIXES)
    const suffix = pick(SUFFIXES)
    const digits = pick(PRECISIONS)
    const form = pick(FORMS)
    const helperFile = pick(HELPER_FILES)
    const helperName = pick(HELPER_NAMES)
    const siteFile = pick(SITE_FILES)
    const unit = pick(UNITS)

    let site: Side = { form, digits, prefix, suffix, input: "value" }
    if (family === "legitimate_local") {
      const dimension = pick(DIMENSIONS)
      if (dimension === "digits" || dimension === "prefix" || dimension === "suffix") {
        // One step around a four- or five-element cycle can never land on the
        // value it started from, so the difference is guaranteed, not hoped for.
        if (dimension === "digits") {
          site = { ...site, digits: (digits + 1 + pick(STEPS)) % PRECISIONS.length }
        }
        if (dimension === "prefix") {
          site = { ...site, prefix: besides(PREFIXES, prefix) }
        }
        if (dimension === "suffix") {
          site = { ...site, suffix: besides(SUFFIXES, suffix) }
        }
      }
      if (dimension === "form") {
        const next = pick(FORMS)
        site = { ...site, form: next === form ? (form === "plain" ? "rounded" : "plain") : next }
      }
    }
    if (family === "near_miss") site = { ...site, input: pick(nearMissInputs(form)) }

    const helperSide: Side = { form, digits, prefix, suffix, input: "value" }
    const helperExpression = render(helperSide, pick(LAYOUTS), pick(WRAPS), pick(INPUTS))
    let siteExpression = render(site, pick(LAYOUTS), pick(WRAPS), pick(INPUTS))
    // A re-implementation spelled differently is still a re-implementation: the
    // predicate has to see through whitespace and parentheses, and this is what
    // makes the family prove it.
    if (siteExpression === helperExpression) {
      siteExpression = render(site, "spaced", "wrapped", "wrapped")
    }

    const atom: SyntheticAtom = {
      site: { unit, file: siteFile, refs: ["value"], source: siteExpression },
      helpers: [
        {
          name: helperName,
          file: helperFile,
          body: `function ${helperName}(value) {\n  return ${helperExpression}\n}`,
        },
      ],
    }
    const id = atomId(atom)
    const question = verdictQuestion(id)
    const itemState: SinglePathState = { atoms: { [id]: atom } }
    return {
      question: {
        ruleId: SINGLE_PATH_RULE_ID,
        decisionId: "verdict",
        kind: "Classify",
        // The rule's third criterion (`not_a_derivation`) is carried with the
        // question; a generated state is always a derived display value, so the
        // corpus offers the two labels a site can be judged between.
        labelSet: ["reimplements", "legitimate_local"],
        instructions: question.instructions,
        criteria: question.criteria,
      },
      state: itemState,
      label: truth(itemState),
      provenance: {
        generator: "single-path",
        generatorVersion: GENERATOR_VERSION,
        predicateId: PREDICATE_ID,
        predicateVersion: PREDICATE_VERSION,
        source: "synthetic",
        truth: evaluate(itemState).executed,
        family,
      },
    }
  }

  const families: Array<SinglePathFamily> = []
  const negative = Math.floor(count / 2)
  for (let index = 0; index < count - negative; index += 1) families.push("reimplements")
  for (let index = 0; index < Math.floor(negative / 2); index += 1) {
    families.push("legitimate_local")
  }
  while (families.length < count) families.push("near_miss")
  // Shuffled, so the sequence carries no label pattern a classifier could read
  // off the line number.
  for (let index = families.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    const held = families[index]
    const swapped = families[other]
    if (held === undefined || swapped === undefined) continue
    families[index] = swapped
    families[other] = held
  }

  const items: Array<SyntheticItem> = []
  const seen = new Set<string>()
  for (const family of families) {
    let item = build(family)
    // Two identical states would be one observation counted twice, and a
    // majority baseline measured on them would be measured on the duplicate.
    for (let attempt = 0; attempt < 64 && seen.has(canonical(item.state)); attempt += 1) {
      item = build(family)
    }
    seen.add(canonical(item.state))
    items.push(item)
  }
  return items
}

/**
 * The manifest for one emission.
 *
 * `corpusHash` is over the sorted canonical JSON of the items, so a reordering
 * of lines cannot claim a new corpus and a changed byte cannot hide behind one.
 *
 * @param request - the emitted items and the seed that produced them.
 * @returns the manifest, including the counts `near_miss` is not a label but a
 *   recipe, so it is counted from provenance while the labels are counted from
 *   `label`.
 */
export const corpusManifest = ({
  items,
  seed,
}: {
  readonly items: ReadonlyArray<SyntheticItem>
  readonly seed: number
}): CorpusManifest => {
  let reimplements = 0
  let legitimateLocal = 0
  let nearMiss = 0
  let predicateFailures = 0
  const canonicalStates = new Set<string>()
  const canonicalItems: Array<string> = []
  for (const item of items) {
    if (item.label === "reimplements") reimplements += 1
    else legitimateLocal += 1
    if (item.provenance.family === "near_miss") nearMiss += 1
    if (truth(item.state) !== item.label) predicateFailures += 1
    canonicalStates.add(canonical(item.state))
    canonicalItems.push(canonical(item))
  }
  return {
    corpusHash: shortHash(
      canonicalItems.sort((left, right) => left.localeCompare(right)).join("\n"),
    ),
    seed,
    generatorVersion: GENERATOR_VERSION,
    predicateVersion: PREDICATE_VERSION,
    counts: {
      reimplements,
      legitimate_local: legitimateLocal,
      near_miss: nearMiss,
    },
    predicateFailures,
    duplicates: items.length - canonicalStates.size,
  }
}
