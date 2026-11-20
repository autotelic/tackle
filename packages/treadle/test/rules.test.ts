import { describe, expect, it } from 'vitest'
import {
  guardHolds,
  isStalled,
  lintRules,
  matchRule,
  type Rule,
  type RuleContext,
} from '../src/loop/rules.ts'

const fixRule: Rule = {
  name: 'fix failing checks',
  on: 'checks.failed',
  in: 'evaluating',
  guard: 'budget-left',
  action: { type: 'session', session: 'fix-checks' },
}

const readyRule: Rule = {
  name: 'feature done → ready',
  on: 'feature.done',
  in: 'feature-check',
  action: { type: 'effect', effect: 'mark-ready-and-notify' },
}

const ctx = (partial: Partial<RuleContext> = {}): RuleContext => ({
  passesUsed: 1,
  budget: 3,
  frontierHistory: [2],
  failureSets: [['unit › a']],
  ...partial,
})

describe('matchRule', () => {
  it('matches on event and state, declaration order wins', () => {
    expect(matchRule([fixRule, readyRule], 'checks.failed', 'evaluating', ctx())).toBe(fixRule)
    expect(matchRule([readyRule, fixRule], 'checks.failed', 'evaluating', ctx())).toBe(fixRule)
  })

  it('skips rules whose state or event does not match', () => {
    expect(matchRule([fixRule], 'checks.failed', 'working', ctx())).toBeNull()
    expect(matchRule([fixRule], 'checks.passed', 'evaluating', ctx())).toBeNull()
    expect(matchRule([readyRule], 'feature.done', 'feature-check', ctx())).toBe(readyRule)
  })

  it('skips rules whose guard does not hold', () => {
    expect(matchRule([fixRule], 'checks.failed', 'evaluating', ctx({ passesUsed: 3 }))).toBeNull()
  })
})

describe('isStalled', () => {
  it('is not stalled with a shrinking frontier', () => {
    expect(isStalled(ctx({ frontierHistory: [5, 3, 1], failureSets: [['a'], ['b'], ['c']] }))).toBe(
      false,
    )
  })

  it('is stalled after two non-shrinking passes', () => {
    expect(isStalled(ctx({ frontierHistory: [3, 3, 3], failureSets: [['a'], ['b'], ['c']] }))).toBe(
      true,
    )
    expect(isStalled(ctx({ frontierHistory: [3, 3], failureSets: [['a'], ['b']] }))).toBe(false)
  })

  it('is stalled on an identical failure set, but not on a single rise', () => {
    expect(isStalled(ctx({ frontierHistory: [3, 2, 2], failureSets: [['a'], ['b'], ['b']] }))).toBe(
      true,
    )
    expect(isStalled(ctx({ frontierHistory: [2, 3], failureSets: [['a'], ['b']] }))).toBe(false)
  })
})

describe('guardHolds', () => {
  it('budget-left while passes remain', () => {
    expect(guardHolds('budget-left', ctx({ passesUsed: 2 }))).toBe(true)
    expect(guardHolds('budget-left', ctx({ passesUsed: 3 }))).toBe(false)
  })
})

describe('lintRules', () => {
  it('warns when a later rule can never fire', () => {
    const shadow: Rule = { ...fixRule, name: 'shadow' }
    expect(lintRules([fixRule, shadow])).toHaveLength(1)
    expect(lintRules([fixRule, readyRule])).toHaveLength(0)
  })
})
