import { describe, expect, it } from 'vitest'
import { computeDecrement } from './decrement'

describe('computeDecrement', () => {
  it('recovers an exact linear decline', () => {
    const r = computeDecrement([10, 9, 8, 7, 6, 5])
    expect(r.regressionPct).toBeCloseTo(50, 6) // slope −1 · 5 / intercept 10
    expect(r.thirdsPct).toBeCloseTo((1 - 5.5 / 9.5) * 100, 6)
  })

  it('reports ~0 for a flat sequence', () => {
    const r = computeDecrement([4, 4, 4, 4, 4, 4])
    expect(r.regressionPct).toBeCloseTo(0, 6)
    expect(r.thirdsPct).toBeCloseTo(0, 6)
  })

  it('is negative for an increasing sequence', () => {
    const r = computeDecrement([5, 6, 7, 8])
    expect(r.regressionPct).toBeLessThan(0)
  })

  it('needs at least 4 events for regression and 6 for thirds', () => {
    expect(computeDecrement([3, 2, 1]).regressionPct).toBeNull()
    const r = computeDecrement([5, 4, 3, 2])
    expect(r.regressionPct).not.toBeNull()
    expect(r.thirdsPct).toBeNull()
  })

  it('returns null instead of dividing by a ~zero intercept', () => {
    expect(computeDecrement([0, 0, 0, 0]).regressionPct).toBeNull()
  })
})
