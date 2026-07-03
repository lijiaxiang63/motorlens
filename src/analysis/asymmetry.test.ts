import { describe, expect, it } from 'vitest'
import { computeTapMetrics } from '../metrics/taps'
import { makeTapFrames } from '../replay/synthetic'
import type { StoredResult } from '../store/subjects'
import type { CycleTestMetrics, Hand } from '../types'
import { asymmetryForPair, computeAsymmetry, formatAsymmetryValue } from './asymmetry'
import { localDayKey, pairResults } from './pairing'

function fakeMetrics(count: number): CycleTestMetrics {
  return {
    count,
    frequencyHz: 2,
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

function fakeResult(id: string, hand: Hand, startedAt: string): StoredResult {
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
      metrics: fakeMetrics(20),
      series: { t: [], v: [] },
      events: [],
      raw: { frames: [] },
    },
  }
}

describe('pairing', () => {
  it('localDayKey uses local calendar components', () => {
    const iso = new Date(2026, 5, 15, 23, 30).toISOString()
    expect(localDayKey(iso)).toBe('2026-06-15')
  })

  it('pairs the latest left and latest right result per local day, newest day first', () => {
    const results = [
      fakeResult('l1', 'left', new Date(2026, 5, 15, 10, 0).toISOString()),
      fakeResult('l2', 'left', new Date(2026, 5, 15, 11, 0).toISOString()),
      fakeResult('r1', 'right', new Date(2026, 5, 15, 12, 0).toISOString()),
      fakeResult('l3', 'left', new Date(2026, 5, 16, 9, 0).toISOString()),
    ]
    const pairs = pairResults(results, 'finger_tap')
    expect(pairs).toHaveLength(2)
    expect(pairs[0]!.dayKey).toBe('2026-06-16')
    expect(pairs[0]!.left?.id).toBe('l3')
    expect(pairs[0]!.right).toBeNull()
    expect(pairs[1]!.dayKey).toBe('2026-06-15')
    // Newer same-day left (11:00) replaces the older one (10:00).
    expect(pairs[1]!.left?.id).toBe('l2')
    expect(pairs[1]!.right?.id).toBe('r1')
  })

  it('does not merge a late-night result with the next local day', () => {
    const results = [
      fakeResult('a', 'left', new Date(2026, 5, 15, 23, 50).toISOString()),
      fakeResult('b', 'right', new Date(2026, 5, 16, 0, 10).toISOString()),
    ]
    expect(pairResults(results, 'finger_tap')).toHaveLength(2)
  })

  it('never crashes on joint_monitor results mixed in', () => {
    const jointish: StoredResult = {
      ...fakeResult('j', 'right', new Date(2026, 5, 15, 8, 0).toISOString()),
      testId: 'joint_monitor',
      report: {
        ...fakeResult('j', 'right', new Date(2026, 5, 15, 8, 0).toISOString()).report,
        test: 'joint_monitor',
        metrics: {} as CycleTestMetrics,
      },
    }
    expect(() => pairResults([jointish], 'finger_tap')).not.toThrow()
    expect(pairResults([jointish], 'finger_tap')).toHaveLength(0)
  })
})

describe('computeAsymmetry', () => {
  it('gives a positive frequency AI% for a faster right hand vs a slower left', () => {
    const right = computeTapMetrics(makeTapFrames({ freqHz: 2 }).frames).metrics
    const left = computeTapMetrics(makeTapFrames({ freqHz: 1.6 }).frames).metrics
    const rows = computeAsymmetry('finger_tap', left, right)
    const freq = rows.find((r) => r.key === 'frequencyHz')!
    expect(freq.value).not.toBeNull()
    // 200 * (2 - 1.6) / 3.6 = 22.22%
    expect(Math.abs(freq.value! - 22.22)).toBeLessThan(1)
  })

  it('gives near-zero asymmetry on every metric for identical left/right runs', () => {
    const metrics = computeTapMetrics(makeTapFrames({ freqHz: 2, decrementPct: 10 }).frames).metrics
    const rows = computeAsymmetry('finger_tap', metrics, metrics)
    for (const row of rows) {
      expect(row.value).not.toBeNull()
      expect(Number.isFinite(row.value!)).toBe(true)
      expect(Math.abs(row.value!)).toBeLessThan(3)
    }
  })

  it('never produces NaN or Infinity when one side is missing', () => {
    const right = computeTapMetrics(makeTapFrames({ freqHz: 2 }).frames).metrics
    const rows = computeAsymmetry('finger_tap', null, right)
    for (const row of rows) {
      expect(row.value).toBeNull()
      expect(row.left).toBeNull()
    }
  })

  it('does not divide by a near-zero denominator', () => {
    const zeroBoth = { ...fakeMetrics(0), amplitudeMean: 0 }
    const rows = computeAsymmetry('finger_tap', zeroBoth, zeroBoth)
    const amp = rows.find((r) => r.key === 'amplitudeMean')!
    expect(amp.value).toBe(0)
    expect(Number.isFinite(amp.value!)).toBe(true)
  })
})

describe('asymmetryForPair', () => {
  it('unwraps a full pair', () => {
    const left = fakeResult('l', 'left', new Date(2026, 0, 1, 9).toISOString())
    const right = fakeResult('r', 'right', new Date(2026, 0, 1, 10).toISOString())
    const rows = asymmetryForPair({ dayKey: '2026-01-01', testId: 'finger_tap', left, right })
    expect(rows.every((r) => r.value !== null)).toBe(true)
  })

  it('reports an unpaired (single-hand) day as nulls, never a crash', () => {
    const right = fakeResult('r', 'right', new Date(2026, 0, 1, 10).toISOString())
    const rows = asymmetryForPair({ dayKey: '2026-01-01', testId: 'finger_tap', left: null, right })
    expect(rows.every((r) => r.value === null)).toBe(true)
    expect(rows.every((r) => r.right !== null)).toBe(true)
    expect(rows.every((r) => r.left === null)).toBe(true)
  })

  it('reports a fully empty pair as all-null without crashing', () => {
    const rows = asymmetryForPair({ dayKey: '2026-01-01', testId: 'finger_tap', left: null, right: null })
    expect(rows.every((r) => r.value === null)).toBe(true)
  })
})

describe('formatAsymmetryValue', () => {
  it('signs ratio and points rows explicitly, using the metric own precision for points', () => {
    expect(
      formatAsymmetryValue({
        key: 'frequencyHz', label: '', digits: 2, unit: ' Hz', left: 1.6, right: 2, kind: 'ratio', direction: 'higher-better', value: 22.22,
      }),
    ).toBe('+22%')
    expect(
      formatAsymmetryValue({
        key: 'ampDecrementPct', label: '', digits: 0, unit: '%', left: 30, right: 10, kind: 'points', direction: 'lower-better', value: -20,
      }),
    ).toBe('−20 pts')
    expect(
      formatAsymmetryValue({
        key: 'frequencyHz', label: '', digits: 2, unit: ' Hz', left: 2, right: 2, kind: 'ratio', direction: 'higher-better', value: 0,
      }),
    ).toBe('±0%')
    expect(
      formatAsymmetryValue({
        key: 'frequencyHz', label: '', digits: 2, unit: ' Hz', left: null, right: null, kind: 'ratio', direction: 'higher-better', value: null,
      }),
    ).toBe('—')
    // floating-point noise that rounds to zero reads as ± not a confusing "−0%"
    expect(
      formatAsymmetryValue({
        key: 'frequencyHz', label: '', digits: 2, unit: ' Hz', left: 2, right: 2, kind: 'ratio', direction: 'higher-better', value: -1e-13,
      }),
    ).toBe('±0%')
  })
})
