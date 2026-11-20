import { describe, expect, it } from 'vitest'
import { passConsumesBudget } from '../src/budget.ts'

describe('passConsumesBudget', () => {
  it('exempts a failed pass that strictly shrank the frontier', () => {
    expect(passConsumesBudget({ previousFrontier: 7, frontier: 5 })).toBe(false)
    expect(passConsumesBudget({ previousFrontier: 1, frontier: 0 })).toBe(false)
  })

  it('consumes flat, growing and first passes', () => {
    expect(passConsumesBudget({ previousFrontier: 5, frontier: 5 })).toBe(true)
    expect(passConsumesBudget({ previousFrontier: 5, frontier: 8 })).toBe(true)
    expect(passConsumesBudget({ previousFrontier: null, frontier: 3 })).toBe(true)
  })
})
