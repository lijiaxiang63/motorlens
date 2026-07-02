import { describe, expect, it } from 'vitest'
import { computeTapMetrics } from '../metrics/taps'
import { buildSessionReport } from '../report/export'
import { makeTapFrames } from '../replay/synthetic'
import type { MetricKey } from './metricCatalog'
import {
  METRIC_CATALOG,
  cycleMetricsOf,
  formatDelta,
  formatMetric,
  metricByKey,
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
    expect(metricByKey('count').getter(metrics)).toBe(metrics.count)
    expect(metricByKey('frequencyHz').getter(metrics)).toBe(metrics.frequencyHz)
    expect(metricByKey('amplitudeMean').getter(metrics)).toBe(metrics.amplitudeMean)
    expect(metricByKey('amplitudeMax').getter(metrics)).toBe(metrics.amplitudeMax)
    expect(metricByKey('closingVelMean').getter(metrics)).toBe(metrics.closingVelMean)
    expect(metricByKey('closingVelPeak').getter(metrics)).toBe(metrics.closingVelPeak)
    expect(metricByKey('openingVelMean').getter(metrics)).toBe(metrics.openingVelMean)
    expect(metricByKey('ampDecrementPct').getter(metrics)).toBe(
      metrics.amplitudeDecrement.regressionPct,
    )
    expect(metricByKey('velDecrementPct').getter(metrics)).toBe(
      metrics.velocityDecrement.regressionPct,
    )
    expect(metricByKey('itiCvPct').getter(metrics)).toBe(metrics.rhythm.itiCvPct)
    expect(metricByKey('hesitationCount').getter(metrics)).toBe(metrics.rhythm.hesitationCount)
    expect(metricByKey('itiMeanMs').getter(metrics)).toBe(metrics.rhythm.itiMeanMs)
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
})
