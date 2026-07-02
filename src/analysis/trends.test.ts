import { describe, expect, it } from 'vitest'
import type { StoredResult } from '../store/subjects'
import type { CycleTestMetrics, Hand } from '../types'
import { buildTrend, deltasVsPrevious } from './trends'

function fakeMetrics(frequencyHz: number | null): CycleTestMetrics {
  return {
    count: 20,
    frequencyHz,
    amplitudeMean: 1,
    amplitudeMax: 1.1,
    amplitudeMeanCm: 8,
    closingVelMean: 5,
    closingVelPeak: 6,
    closingVelPeakCmS: 40,
    openingVelMean: 5,
    openingVelPeak: 6,
    amplitudeDecrement: { regressionPct: 0, thirdsPct: 0 },
    velocityDecrement: { regressionPct: 0, thirdsPct: 0 },
    rhythm: { itiMeanMs: 500, itiCvPct: 2, hesitationCount: 0, longestPauseMs: null, droppedIntervals: 0 },
    cmPerUnit: 8,
  }
}

const DAY0 = Date.UTC(2026, 0, 1)
const dayIso = (offsetDays: number) => new Date(DAY0 + offsetDays * 86_400_000).toISOString()

function fakeResult(
  id: string,
  hand: Hand,
  startedAt: string,
  frequencyHz: number | null,
): StoredResult {
  return {
    id,
    subjectId: 'subj-1',
    testId: 'finger_tap',
    hand,
    source: 'live',
    startedAt,
    report: {
      schemaVersion: 1,
      app: { name: 'MotorLens', version: '0.0.0' },
      test: 'finger_tap',
      hand,
      startedAt,
      durationMs: 10_000,
      quality: null,
      metrics: fakeMetrics(frequencyHz),
      series: { t: [], v: [] },
      events: [],
      raw: { frames: [] },
    },
  }
}

describe('buildTrend', () => {
  // Days 0/10/20/30/40, frequencyHz = 2.0, 2.1, null, 2.4, 2.2.
  const fixture = [
    fakeResult('r0', 'right', dayIso(0), 2.0),
    fakeResult('r1', 'right', dayIso(10), 2.1),
    fakeResult('r2', 'right', dayIso(20), null),
    fakeResult('r3', 'right', dayIso(30), 2.4),
    fakeResult('r4', 'right', dayIso(40), 2.2),
  ]

  it('gives exact deltas and a hand-computable Theil–Sen slope', () => {
    const trend = buildTrend(fixture, 'finger_tap', 'right', 'frequencyHz')
    expect(trend.points).toHaveLength(5)
    expect(trend.points.map((p) => p.value)).toEqual([2.0, 2.1, null, 2.4, 2.2])
    expect(trend.points.map((p) => p.tDays)).toEqual([0, 10, 20, 30, 40])
    // Last value 2.2 minus the last non-null prior (2.4, skipping the null at day 20).
    expect(trend.deltaVsPrevious).toBeCloseTo(-0.2, 10)
    // 6 valid pairs -> slopes [0.01, 0.01333, 0.005, 0.015, 0.00333, -0.02] /day;
    // median of the sorted 6 = avg(0.005, 0.01) = 0.0075/day -> ×30 = 0.225.
    expect(trend.slopePer30d).toBeCloseTo(0.225, 6)
    expect(trend.line).not.toBeNull()
  })

  it('is independent of input insertion order', () => {
    const shuffled = [fixture[3]!, fixture[0]!, fixture[4]!, fixture[2]!, fixture[1]!]
    const a = buildTrend(fixture, 'finger_tap', 'right', 'frequencyHz')
    const b = buildTrend(shuffled, 'finger_tap', 'right', 'frequencyHz')
    expect(b).toEqual(a)
  })

  it('handles a single result: one point, null slope and delta', () => {
    const trend = buildTrend([fixture[0]!], 'finger_tap', 'right', 'frequencyHz')
    expect(trend.points).toHaveLength(1)
    expect(trend.deltaVsPrevious).toBeNull()
    expect(trend.slopePer30d).toBeNull()
    expect(trend.line).toBeNull()
  })

  it('handles all-null values without producing NaN', () => {
    const allNull = [
      fakeResult('n0', 'right', dayIso(0), null),
      fakeResult('n1', 'right', dayIso(10), null),
    ]
    const trend = buildTrend(allNull, 'finger_tap', 'right', 'frequencyHz')
    expect(trend.points.every((p) => p.value === null)).toBe(true)
    expect(trend.deltaVsPrevious).toBeNull()
    expect(trend.slopePer30d).toBeNull()
    expect(trend.line).toBeNull()
  })

  it('handles no matching results at all', () => {
    const trend = buildTrend([], 'finger_tap', 'right', 'frequencyHz')
    expect(trend.points).toEqual([])
    expect(trend.deltaVsPrevious).toBeNull()
    expect(trend.slopePer30d).toBeNull()
  })

  it('filters by test id and hand', () => {
    const mixed = [
      ...fixture,
      fakeResult('other-hand', 'left', dayIso(5), 9),
      { ...fakeResult('other-test', 'right', dayIso(5), 9), testId: 'fist_open_close' as const },
    ]
    const trend = buildTrend(mixed, 'finger_tap', 'right', 'frequencyHz')
    expect(trend.points).toHaveLength(5)
  })
})

describe('deltasVsPrevious', () => {
  it('uses the last non-null prior, skipping a null-metric newest prior', () => {
    const current = fakeMetrics(2.5)
    const priors = [
      fakeResult('p-old', 'right', dayIso(0), 2.0),
      fakeResult('p-newest', 'right', dayIso(20), null), // most recent, but null
    ]
    const deltas = deltasVsPrevious(current, priors)
    expect(deltas.frequencyHz).toBeCloseTo(0.5, 10) // 2.5 - 2.0
  })

  it('returns null when every prior is null for that metric', () => {
    const current = fakeMetrics(2.5)
    const priors = [fakeResult('p1', 'right', dayIso(0), null)]
    expect(deltasVsPrevious(current, priors).frequencyHz).toBeNull()
  })

  it('returns null when there are no priors at all', () => {
    const current = fakeMetrics(2.5)
    expect(deltasVsPrevious(current, []).frequencyHz).toBeNull()
  })
})
