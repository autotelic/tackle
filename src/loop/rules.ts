/**
 * Rules (#6): a user-defined triple of event, machine state, and optional
 * guard, mapping to the action the Loop takes. When several rules match the
 * same (state, event), declaration order wins; shadowed rules warn at load.
 *
 * The vocabulary is closed for v1: session actions spawn a Session with a
 * known prompt shape; effect actions are side effects the runner performs.
 */

export type RuleEvent = 'checks.failed' | 'checks.passed' | 'feature.done' | 'session.blocked'

export type RuleAction =
  | { type: 'session'; session: 'fix-checks' | 'review' }
  | { type: 'effect'; effect: 'mark-ready-and-notify' }

export type RuleGuard = 'budget-left' | 'not-stalled'

export type Rule = {
  name: string
  on: RuleEvent
  in?: string
  guard?: RuleGuard
  action: RuleAction
}

export type RuleContext = {
  passesUsed: number
  budget: number
  /** Frontier per evaluated Pass so far, oldest first. */
  frontierHistory: number[]
  /** Failure sets per evaluated Pass (for the identical-set stall check). */
  failureSets: string[][]
}

export function guardHolds(guard: RuleGuard, context: RuleContext): boolean {
  switch (guard) {
    case 'budget-left':
      return context.passesUsed < context.budget
    case 'not-stalled':
      return !isStalled(context)
  }
}

/**
 * #9: stalled when the Failure set hasn't shrunk for 2 Passes in a row, or
 * it's identical to an earlier Pass's set. A single rise is not a stall,
 * because new tests start out red.
 */
export function isStalled(context: RuleContext): boolean {
  const history = context.frontierHistory
  if (history.length >= 2) {
    const last = history[history.length - 1] as number
    const before = history[history.length - 2] as number
    if (last >= before && history.length >= 3) {
      const third = history[history.length - 3] as number
      if (before >= third) return true
    }
  }
  const sets = context.failureSets.map((set) => JSON.stringify([...set].sort()))
  return new Set(sets).size !== sets.length
}

/** First match in declaration order wins (#6). */
export function matchRule(
  rules: Rule[],
  event: RuleEvent,
  state: string,
  context: RuleContext,
): Rule | null {
  for (const rule of rules) {
    if (rule.on !== event) continue
    if (rule.in !== undefined && rule.in !== state) continue
    if (rule.guard !== undefined && !guardHolds(rule.guard, context)) continue
    return rule
  }
  return null
}

/**
 * Rules that can never fire: an earlier rule matches the same (state, event)
 * and either has no guard (it always wins) or the same guard (both evaluate
 * identically, so the earlier one always wins).
 */
export function lintRules(rules: Rule[]): string[] {
  const warnings: string[] = []
  const earlier = new Map<string, Rule[]>()
  for (const rule of rules) {
    const key = `${rule.in ?? '*'}:${rule.on}`
    for (const first of earlier.get(key) ?? []) {
      if (first.guard === undefined || first.guard === rule.guard) {
        warnings.push(
          `rule "${rule.name}" is shadowed by "${first.name}" (${key}) and can never fire`,
        )
        break
      }
    }
    earlier.set(key, [...(earlier.get(key) ?? []), rule])
  }
  return warnings
}
