import { describe, expect, it } from 'vitest'
import { computeFistMetrics } from '../metrics/fist'
import { computeTapMetrics } from '../metrics/taps'
import { makeFistFrames, makeTapFrames } from '../replay/synthetic'
import { buildSessionReport } from '../report/export'
import type { StoredResult } from '../store/subjects'
import type { CycleAnalysis, Hand, TestId } from '../types'
import { buildCompare } from './compare'

function toStoredResult(
  id: string,
  testId: TestId,
  hand: Hand,
  startedAt: string,
  analysis: CycleAnalysis,
  frames: StoredResult['report']['raw']['frames'],
): StoredResult {
  const report = buildSessionReport({ test: testId, hand, startedAt, durationMs: 10_000, analysis, frames })
  return { id, subjectId: 's1', testId, hand, source: 'live', startedAt, report }
}

describe('buildCompare', () => {
  it('shows ~0% vs 25-35% amplitude decrement for tap-2hz vs tap-decrement, signals rebased to t=0', () => {
    const framesA = makeTapFrames({ freqHz: 2 }).frames
    const framesB = makeTapFrames({ decrementPct: 30 }).frames
    const a = toStoredResult(
      'a', 'finger_tap', 'right', '2026-01-01T00:00:00.000Z', computeTapMetrics(framesA), framesA,
    )
    const b = toStoredResult(
      'b', 'finger_tap', 'right', '2026-01-02T00:00:00.000Z', computeTapMetrics(framesB), framesB,
    )
    const cmp = buildCompare(a, b)

    expect(cmp.sameTest).toBe(true)
    const decrement = cmp.rows.find((r) => r.key === 'ampDecrementPct')!
    expect(Math.abs(decrement.a!)).toBeLessThan(10)
    expect(decrement.b!).toBeGreaterThan(25)
    expect(decrement.b!).toBeLessThan(35)
    expect(decrement.delta).toBeCloseTo(decrement.b! - decrement.a!, 10)

    expect(cmp.signals).not.toBeNull()
    expect(cmp.signals!.a.t[0]).toBe(0)
    expect(cmp.signals!.b.t[0]).toBe(0)
    expect(cmp.amplitudes).not.toBeNull()
    expect(cmp.amplitudes!.a.length).toBeGreaterThan(0)
    expect(cmp.amplitudes!.b.length).toBeGreaterThan(0)
  })

  it('degrades to table-only for mismatched test ids (no overlay data fabricated)', () => {
    const framesA = makeTapFrames({ freqHz: 2 }).frames
    const framesB = makeFistFrames({ freqHz: 1.5 }).frames
    const a = toStoredResult(
      'a', 'finger_tap', 'right', '2026-01-01T00:00:00.000Z', computeTapMetrics(framesA), framesA,
    )
    const b = toStoredResult(
      'b', 'fist_open_close', 'right', '2026-01-02T00:00:00.000Z', computeFistMetrics(framesB), framesB,
    )
    const cmp = buildCompare(a, b)

    expect(cmp.sameTest).toBe(false)
    expect(cmp.signals).toBeNull()
    expect(cmp.amplitudes).toBeNull()
    expect(cmp.rows.length).toBe(12)
  })

  it('never crashes when a side has no cycle metrics (e.g. a joint_monitor result)', () => {
    const framesA = makeTapFrames({ freqHz: 2 }).frames
    const a = toStoredResult(
      'a', 'finger_tap', 'right', '2026-01-01T00:00:00.000Z', computeTapMetrics(framesA), framesA,
    )
    const bReport = buildSessionReport({
      test: 'joint_monitor',
      hand: 'right',
      startedAt: '2026-01-02T00:00:00.000Z',
      durationMs: 1000,
      analysis: null,
      frames: [],
    })
    const b: StoredResult = {
      id: 'b', subjectId: 's1', testId: 'joint_monitor', hand: 'right',
      source: 'live', startedAt: bReport.startedAt, report: bReport,
    }
    const cmp = buildCompare(a, b)
    expect(cmp.rows.every((r) => r.b === null)).toBe(true)
    expect(cmp.rows.every((r) => r.delta === null)).toBe(true)
  })
})
