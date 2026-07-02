import { describe, expect, it } from 'vitest'
import { cvPct, linearRegression, mean, median, percentile, sd } from './stats'

describe('stats', () => {
  it('mean/sd/cv', () => {
    expect(mean([2, 4, 6])).toBe(4)
    expect(sd([2, 4, 6])).toBeCloseTo(2, 10)
    expect(cvPct([2, 4, 6])).toBeCloseTo(50, 10)
    expect(Number.isNaN(sd([1]))).toBe(true)
    expect(Number.isNaN(cvPct([0, 0, 0]))).toBe(true)
  })

  it('median and percentile interpolate', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(percentile([0, 10], 25)).toBe(2.5)
    expect(percentile([5], 90)).toBe(5)
    expect(Number.isNaN(percentile([], 50))).toBe(true)
  })

  it('linear regression recovers slope and intercept', () => {
    const x = [0, 1, 2, 3, 4]
    const y = x.map((xi) => 3 - 0.5 * xi)
    const r = linearRegression(x, y)
    expect(r.slope).toBeCloseTo(-0.5, 10)
    expect(r.intercept).toBeCloseTo(3, 10)
  })
})
