// Meta-rules: the fence for rule authors.
//
// plumb ships rules that lint its own plugin authors (`require-create-once`,
// `require-rule-tester`, `no-manual-ancestor-walks`). joggle had none, which is
// why this session shipped a rule with no `violations`, an unbounded atom and an
// inline message before anyone noticed. These are the same idea: a small, named
// set of invariants every rule in this repository must keep, checkable from the
// source and enforced by a test.
//
// They are deliberately source-level. A rule's `plan` cannot be run without a
// workspace and a model, so the check reads what a rule declares rather than what
// it does -- the same trade plumb's meta-rules make over the plugin source.

/** One rule module, as the meta-rules see it. */
export interface RuleSource {
  /** The file's basename without `.ts`, which is also the test file's basename. */
  readonly name: string
  /** The rule module's own text, read off disk. */
  readonly text: string
  /** True when the module needs the model. */
  readonly judged: boolean
  /** The names the module exports, so a test can name any of them. */
  readonly names: ReadonlyArray<string>
  /** The rule ids the module declares. */
  readonly ruleIds: ReadonlyArray<string>
  /** True when the module delegates its plans to `cluster-verdict.ts`. */
  readonly delegates: boolean
}

/** One broken authorship rule. */
export interface MetaFinding {
  /** The meta-rule that was broken. */
  readonly metaRule: string
  /** The rule module, by basename. */
  readonly rule: string
  readonly detail: string
}

/**
 * The `atoms.add({...})` arguments in a source, by balanced braces.
 *
 * A source scan rather than a parse: the check only needs to see whether an atom
 * carries a whole file, and the balanced-brace walk is enough to tell that from a
 * sliced one.
 */
export const atomPayloads = (source: string): ReadonlyArray<string> => {
  const found: Array<string> = []
  const marker = "atoms.add("
  let cursor = source.indexOf(marker)
  while (cursor !== -1) {
    const open = cursor + marker.length
    let depth = 0
    let index = open
    for (; index < source.length; index += 1) {
      const character = source[index]
      if (character === "(" || character === "{") depth += 1
      else if (character === ")" || character === "}") {
        depth -= 1
        if (depth === 0) break
      }
    }
    found.push(source.slice(open, index + 1))
    cursor = source.indexOf(marker, index)
  }
  return found
}

/**
 * True when the payload carries a whole file rather than a slice of one.
 *
 * The signal is a literal `.text` (or `text:`) with no `.slice(` beside it. A
 * named field such as `source: candidate.text` is the rule's own bounded
 * sample, whose bound is set where the candidate is built, and this check cannot
 * see that far -- so it does not guess.
 */
const unbounded = (payload: string): boolean =>
  /(\.text\b|\btext\s*:)/.test(payload) && !payload.includes(".slice(")


/**
 * Where a rule decides meaning in code: a regular expression, or a literal
 * vocabulary.
 *
 * The first meta-rule about HOW a rule decides rather than what it declares. It
 * checks the structural shape of a rule's own source -- `docs/rule-coupling.md` --
 * because "which names are formatters" and "which words mean money" are decisions
 * that belong to Jev, and a rule that makes them is coupled to one implementation
 * and will rot. These are the two mechanically detectable kinds; a hand-ranked
 * score (`ruleLikeness`), a string rule for a type question (`canCompose`,
 * `inputKey`) and a text parse for a declared type are the same fault and are
 * found by reading.
 */
export interface Coupling {
  readonly couplingKind: "regex" | "vocabulary"
  readonly detail: string
}

/** A regex literal on its own line: `  /^(format|shown)/,`. */
const REGEX_LINE = /^\s*\/[^/*\n][^\n]*\/[gimsuy]*,?\s*$/m
/** A regex literal in an arrow body: `=> /^(route|page)\.tsx?$/.test(…)`. */
const REGEX_ARROW = /=>\s*\/[^/*\n][^\n]*\/[gimsuy]*/
/** A regex literal applied inline: `/^[a-z]$/.test(name)`. */
const REGEX_APPLIED = /\/[^/*\n][^/\n]*\/[gimsuy]*\.(test|exec|match)\(/
/** A named array or a Set: where a literal vocabulary starts. */
const VOCABULARY_OPEN = /(new Set\(\[|^\s*(?:export )?const [A-Z][A-Z0-9_]*[^=\n]*= \[)/m

/** The bracket-balanced literal that starts at or after `from`. */
const balanced = (source: string, from: number): string => {
  const open = source.indexOf("[", from)
  if (open === -1) return ""
  let depth = 0
  for (let index = open; index < source.length && index < open + 2000; index += 1) {
    const character = source[index]
    if (character === "[") depth += 1
    else if (character === "]") {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  return source.slice(open, open + 2000)
}

/**
 * The coupling in one rule source.
 *
 * @param source - the rule module's text.
 * @returns one entry per mechanical coupling found.
 */
export const couplingIn = (source: string): ReadonlyArray<Coupling> => {
  const found: Array<Coupling> = []
  if (source.includes("new RegExp(")) {
    found.push({ couplingKind: "regex", detail: "builds a RegExp" })
  }
  const literal = REGEX_LINE.exec(source) ?? REGEX_ARROW.exec(source) ?? REGEX_APPLIED.exec(source)
  if (literal !== null) {
    found.push({ couplingKind: "regex", detail: "a regex literal: " + literal[0].trim().slice(0, 70) })
  }
  const open = VOCABULARY_OPEN.exec(source)
  if (open !== null) {
    // The literal's OWN brackets, not a window past them: a window ran into the
    // rule's messages registry and counted message ids as a vocabulary. And the
    // `[` after the `=`, not the one in a type annotation (`readonly [string, string]`).
    const at = open[0].startsWith("new Set")
      ? open.index + open[0].indexOf("[")
      : source.indexOf("[", source.indexOf("=", open.index))
    const words = balanced(source, at).match(/["'][a-z][A-Za-z0-9_]*["']/g) ?? []
    if (words.length >= 3) {
      found.push({
        couplingKind: "vocabulary",
        detail: "a literal vocabulary of " + String(words.length) + ": " + words.slice(0, 6).join(", "),
      })
    }
  }
  return found
}

/**
 * The authorship rules, checked against a set of rule sources and their tests.
 *
 * @param input - the rule sources, the tests' texts, and the shared cluster module.
 * @returns one finding per broken rule, empty when every rule keeps them.
 */
export const metaFindings = (input: {
  readonly rules: ReadonlyArray<RuleSource>
  readonly tests: ReadonlyArray<string>
  readonly shared: string
}): ReadonlyArray<MetaFinding> => {
  const found: Array<MetaFinding> = []
  const namesThisRule = (rule: RuleSource): boolean =>
    input.tests.some(
      (test) =>
        rule.ruleIds.some((id) => test.includes(id)) ||
        rule.names.some((name) => new RegExp("\\b" + name + "\\b").test(test)),
    )
  for (const rule of input.rules) {
    // A rule may opt out of one meta-rule with `meta-allow: <rule>` and a stated
    // reason. The opt-out is explicit and greppable, the way a recorded decision
    // is: an author can make the exception, but not hide it.
    const push = (metaRule: string, detail: string): void => {
      if (!new RegExp("meta-allow:\\s*" + metaRule).test(rule.text)) {
        found.push({ metaRule, rule: rule.name, detail })
      }
    }
    if (!namesThisRule(rule)) {
      push("require-test", "no test names this rule or any symbol it exports")
    }
    // joggle is the JUDGED layer: the cross-file questions a linter and a
    // typechecker cannot answer. A rule that is not judged is one of those tools'
    // jobs -- `unused-import` belongs in oxlint, a type error in tsc -- and a
    // deterministic rule in joggle is a candidate generator that forgot to ask.
    if (!rule.judged) {
      push(
        "require-judged",
        "a rule that is not judged is a linter or typechecker job, not a joggle question",
      )
    }
    if (!rule.judged) continue
    // A judged rule that builds plans must declare what violates it, or
    // calibration cannot reduce its question. A rule that answers its own
    // question has no plan to reduce and is outside that.
    if (rule.text.includes("plan:") && !rule.text.includes("violations")) {
      if (!(rule.delegates && input.shared.includes("violations"))) {
        push(
          "require-violations",
          "a planned rule declares no violating labels, so it cannot be calibrated",
        )
      }
    }
    // A judged rule must read a judgement's quality and act on every band. A band
    // is not a reason to discard an answer, and it is not a reason to shout one
    // either: the rule decides what each band does.
    if (!rule.text.includes("qualityOf")) {
      if (!(rule.delegates && input.shared.includes("qualityOf"))) {
        push(
          "band-the-answer",
          "no gate reads a judgement's quality, so a band cannot decide what to do",
        )
      }
    }
    for (const payload of atomPayloads(rule.text)) {
      if (unbounded(payload)) {
        push("bounded-atoms", "an atom carries a whole file; put a bounded sample in it")
      }
    }
    // How the rule DECIDES, not what it declares: a regex or a literal
    // vocabulary that classifies meaning belongs to Jev (docs/rule-coupling.md).
    for (const coupling of couplingIn(rule.text)) {
      push("no-pattern-classifier", coupling.couplingKind + " -- " + coupling.detail)
    }
  }
  return found
}
