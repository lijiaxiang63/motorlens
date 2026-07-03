import { describe, expect, it } from 'vitest'
import { makeRomSweepFrames, ROM_SWEEP_FLEXIONS } from '../replay/synthetic'
import type { JointId } from '../types'
import { JOINT_IDS } from './angles'
import { computeRomMetrics } from './rom'

describe('computeRomMetrics on synthetic ground truth', () => {
  it('recovers a single-joint 0→90° index-PIP sweep, other joints ≈ 0', () => {
    const { frames } = makeRomSweepFrames({ flexions: { index_pip: 90 } })
    const { metrics, quality } = computeRomMetrics(frames)

    expect(metrics.joints.index_pip.romDeg).not.toBeNull()
    expect(Math.abs(metrics.joints.index_pip.romDeg! - 90)).toBeLessThan(1)
    for (const id of JOINT_IDS) {
      if (id === 'index_pip') continue
      expect(metrics.joints[id].romDeg).not.toBeNull()
      expect(metrics.joints[id].romDeg!).toBeLessThan(1)
    }
    expect(metrics.perFinger.index).not.toBeNull()
    expect(Math.abs(metrics.perFinger.index! - 90)).toBeLessThan(2)
    // Exact identity: total is the sum of the joint ROMs (via per-finger sums).
    const jointSum = JOINT_IDS.reduce((s, id) => s + metrics.joints[id].romDeg!, 0)
    expect(metrics.totalActiveRomDeg).toBeCloseTo(jointSum, 9)
    expect(quality.detectionRate).toBe(1)
    expect(quality.droppedIntervals).toBe(0)
  })

  it('recovers every joint of the full-hand sweep and totals ≈ 890°', () => {
    const { frames, truth } = makeRomSweepFrames()
    const { metrics } = computeRomMetrics(frames)

    for (const [id, scheduled] of Object.entries(truth.maxFlexions)) {
      const rom = metrics.joints[id as JointId].romDeg
      expect(rom).not.toBeNull()
      expect(Math.abs(rom! - scheduled)).toBeLessThan(1.5)
    }
    const scheduledTotal = Object.values(ROM_SWEEP_FLEXIONS).reduce((s, v) => s + v, 0)
    expect(scheduledTotal).toBe(890)
    expect(metrics.totalActiveRomDeg).not.toBeNull()
    expect(Math.abs(metrics.totalActiveRomDeg! - scheduledTotal)).toBeLessThan(1.5 * 15)
    // Exact identity: total is built as Σ perFinger (same addition order);
    // the joint-order sum matches to float precision (addition order differs).
    const fingerSum = Object.values(metrics.perFinger).reduce((s: number, v) => s + v!, 0)
    expect(metrics.totalActiveRomDeg).toBe(fingerSum)
    const jointSum = JOINT_IDS.reduce((s, id) => s + metrics.joints[id].romDeg!, 0)
    expect(metrics.totalActiveRomDeg).toBeCloseTo(jointSum, 9)
    // The summed-flexion trace peaks near the scheduled total.
    const { signal } = computeRomMetrics(frames)
    expect(Math.max(...signal.v)).toBeGreaterThan(scheduledTotal * 0.95)
  })

  it('degrades through a dropout without aborting', () => {
    const { frames } = makeRomSweepFrames({ dropouts: [{ atMs: 4000, durMs: 600 }] })
    const { metrics, quality } = computeRomMetrics(frames)
    expect(metrics.totalActiveRomDeg).not.toBeNull()
    expect(Math.abs(metrics.totalActiveRomDeg! - 890)).toBeLessThan(1.5 * 15)
    expect(quality.detectionRate).toBeLessThan(1)
    expect(quality.droppedIntervals).toBe(1)
  })

  it('returns nulls, not NaNs, for an empty recording', () => {
    const { metrics, quality, signal, events } = computeRomMetrics([])
    for (const id of JOINT_IDS) {
      expect(metrics.joints[id].romDeg).toBeNull()
      expect(metrics.joints[id].peakAngVelDegS).toBeNull()
    }
    expect(metrics.perFinger.index).toBeNull()
    expect(metrics.totalActiveRomDeg).toBeNull()
    expect(signal.t).toHaveLength(0)
    expect(events).toHaveLength(0)
    expect(quality.detectionRate).toBe(0)
    expect(quality.droppedIntervals).toBe(0)
  })

  it('reports plausible peak angular velocity for the sweep', () => {
    // Raised-cosine 0→90→0 over 4 s: peak speed = 90·π/4 ≈ 70.7 °/s.
    const { frames } = makeRomSweepFrames({ flexions: { index_pip: 90 } })
    const { metrics } = computeRomMetrics(frames)
    const peak = metrics.joints.index_pip.peakAngVelDegS
    expect(peak).not.toBeNull()
    expect(peak!).toBeGreaterThan(0.6 * ((90 * Math.PI) / 4))
    expect(peak!).toBeLessThan(1.2 * ((90 * Math.PI) / 4))
  })
})
