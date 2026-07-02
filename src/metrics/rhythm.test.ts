import { describe, expect, it } from 'vitest'
import type { CycleEvent } from '../types'
import { computeRhythm } from './rhythm'

function ev(tMs: number, segment = 0): CycleEvent {
  return {
    tMs,
    closingAmplitude: 1,
    openingAmplitude: 1,
    peakClosingVel: 1,
    peakOpeningVel: 1,
    segment,
  }
}

describe('computeRhythm', () => {
  it('computes mean/CV and flags a hesitation', () => {
    // ITIs: 500, 500, 1500, 500 → median 500, threshold max(1000, 400) = 1000
    const events = [0, 500, 1000, 2500, 3000].map((t) => ev(t))
    const r = computeRhythm(events, 400)
    expect(r.itiMeanMs).toBeCloseTo(750, 6)
    expect(r.hesitationCount).toBe(1)
    expect(r.longestPauseMs).toBe(1500)
    expect(r.itiCvPct).toBeGreaterThan(50)
  })

  it('uses the absolute floor when the median is small', () => {
    // ITIs of 200 with one 500: 2·median = 400 < abs floor 700 → no hesitation
    const events = [0, 200, 400, 900, 1100].map((t) => ev(t))
    const r = computeRhythm(events, 700)
    expect(r.hesitationCount).toBe(0)
  })

  it('excludes intervals spanning segments and counts them as dropped', () => {
    const events = [ev(0, 0), ev(500, 0), ev(2000, 1), ev(2500, 1)]
    const r = computeRhythm(events, 400)
    expect(r.droppedIntervals).toBe(1)
    expect(r.itiMeanMs).toBeCloseTo(500, 6)
    expect(r.hesitationCount).toBe(0)
  })

  it('handles fewer than two events', () => {
    const r = computeRhythm([ev(100)], 400)
    expect(r.itiMeanMs).toBeNull()
    expect(r.itiCvPct).toBeNull()
    expect(r.hesitationCount).toBe(0)
  })
})
