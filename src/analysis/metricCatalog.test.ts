import { describe, expect, it } from 'vitest'
import { computeTapMetrics } from '../metrics/taps'
import { buildSessionReport } from '../report/export'
import { makeTapFrames } from '../replay/synthetic'
import type { MetricKey } from './metricCatalog'
import {
  METRIC_CATALOG,
  cycleMetricsOf,
  deltaTone,
  formatDelta,
  formatMetric,
  metricByKey,
  metricValueOf,
} from './metricCatalog'

describe('metricCatalog', () => {
  it('has 12 unique keys', () => {
    expect(METRIC_CATALOG).toHaveLength(12)
    expect(new Set(METRIC_CATALOG.map((d) => d.key)).size).toBe(12)
  })

  it('every getter reads the matching field off computed tap metrics', () => {
    const { frames } = makeTapFrames({
      freqHz: 2,
      decrementPct: 30,
      hesitations: [{ atMs: 5000, extraMs: 900 }],
    })
    const { metrics } = computeTapMetrics(frames)
    expect(metricValueOf(metricByKey('count'), metrics)).toBe(metrics.count)
    expect(metricValueOf(metricByKey('frequencyHz'), metrics)).toBe(metrics.frequencyHz)
    expect(metricValueOf(metricByKey('amplitudeMean'), metrics)).toBe(metrics.amplitudeMean)
    expect(metricValueOf(metricByKey('amplitudeMax'), metrics)).toBe(metrics.amplitudeMax)
    expect(metricValueOf(metricByKey('closingVelMean'), metrics)).toBe(metrics.closingVelMean)
    expect(metricValueOf(metricByKey('closingVelPeak'), metrics)).toBe(metrics.closingVelPeak)
    expect(metricValueOf(metricByKey('openingVelMean'), metrics)).toBe(metrics.openingVelMean)
    expect(metricValueOf(metricByKey('ampDecrementPct'), metrics)).toBe(
      metrics.amplitudeDecrement.regressionPct,
    )
    expect(metricValueOf(metricByKey('velDecrementPct'), metrics)).toBe(
      metrics.velocityDecrement.regressionPct,
    )
    expect(metricValueOf(metricByKey('itiCvPct'), metrics)).toBe(metrics.rhythm.itiCvPct)
    expect(metricValueOf(metricByKey('hesitationCount'), metrics)).toBe(metrics.rhythm.hesitationCount)
    expect(metricValueOf(metricByKey('itiMeanMs'), metrics)).toBe(metrics.rhythm.itiMeanMs)
  })

  it('metricByKey throws on an unknown key', () => {
    expect(() => metricByKey('bogus' as unknown as MetricKey)).toThrow()
  })

  it('cycleMetricsOf narrows cycle-test reports and rejects joint_monitor reports', () => {
    const { frames } = makeTapFrames({ freqHz: 2 })
    const { metrics } = computeTapMetrics(frames)
    const cycleReport = buildSessionReport({
      test: 'finger_tap',
      hand: 'right',
      startedAt: new Date(2026, 0, 1).toISOString(),
      durationMs: 10_000,
      analysis: computeTapMetrics(frames),
      frames,
    })
    expect(cycleMetricsOf(cycleReport)?.count).toBe(metrics.count)

    const jointReport = buildSessionReport({
      test: 'joint_monitor',
      hand: 'right',
      startedAt: new Date(2026, 0, 1).toISOString(),
      durationMs: 1000,
      analysis: null,
      frames: [],
    })
    expect(cycleMetricsOf(jointReport)).toBeNull()
  })

  it('formatMetric renders — for null, fmt-consistent strings otherwise', () => {
    const freq = metricByKey('frequencyHz')
    expect(formatMetric(freq, null)).toBe('—')
    expect(formatMetric(freq, 2)).toBe('2.00 Hz')
  })

  it('formatDelta signs deltas explicitly and never NaN', () => {
    const freq = metricByKey('frequencyHz')
    expect(formatDelta(freq, null)).toBe('—')
    expect(formatDelta(freq, 0.21)).toBe('+0.21 Hz')
    expect(formatDelta(freq, -0.21)).toBe('−0.21 Hz')
    expect(formatDelta(freq, 0)).toBe('±0.00 Hz')
    expect(formatDelta(freq, NaN)).toBe('—')
  })

  it('never prints a confusing "−0.00" for floating-point noise that rounds to zero', () => {
    const freq = metricByKey('frequencyHz') // 2 digits
    expect(formatDelta(freq, -1e-13)).toBe('±0.00 Hz')
    expect(formatDelta(freq, 1e-13)).toBe('±0.00 Hz')
    // still signs a delta that's genuinely nonzero at the display precision
    expect(formatDelta(freq, -0.01)).toBe('−0.01 Hz')
  })

  it('deltaTone accounts for direction and treats zero/null/neutral specially', () => {
    const freq = metricByKey('frequencyHz') // higher-better
    const decrement = metricByKey('ampDecrementPct') // lower-better
    const itiMean = metricByKey('itiMeanMs') // neutral
    expect(deltaTone(freq, 0.2)).toBe('good')
    expect(deltaTone(freq, -0.2)).toBe('bad')
    expect(deltaTone(decrement, 5)).toBe('bad')
    expect(deltaTone(decrement, -5)).toBe('good')
    expect(deltaTone(freq, 0)).toBe('neutral')
    expect(deltaTone(freq, -1e-13)).toBe('neutral')
    expect(deltaTone(itiMean, -10)).toBe('neutral')
    expect(deltaTone(freq, null)).toBeNull()
    expect(deltaTone(freq, NaN)).toBeNull()
  })
})
