import { describe, expect, it } from 'vitest'
import { buildFlexedHand, makeAngleFrames } from '../replay/synthetic'
import { JOINT_IDS, JointTracker, jointFlexionDeg } from './angles'

describe('jointFlexionDeg', () => {
  it('round-trips forward kinematics within 0.01°', () => {
    for (const target of [0, 15, 30, 60, 90, 110]) {
      const world = buildFlexedHand({
        index_mcp: target,
        index_pip: target,
        index_dip: target,
        thumb_ip: target,
        pinky_pip: target,
      })
      expect(Math.abs(jointFlexionDeg(world, 'index_mcp') - target)).toBeLessThan(0.01)
      expect(Math.abs(jointFlexionDeg(world, 'index_pip') - target)).toBeLessThan(0.01)
      expect(Math.abs(jointFlexionDeg(world, 'index_dip') - target)).toBeLessThan(0.01)
      expect(Math.abs(jointFlexionDeg(world, 'thumb_ip') - target)).toBeLessThan(0.01)
      expect(Math.abs(jointFlexionDeg(world, 'pinky_pip') - target)).toBeLessThan(0.01)
    }
  })

  it('reports ~0° for straightened chains', () => {
    const world = buildFlexedHand({})
    for (const id of JOINT_IDS) {
      expect(Math.abs(jointFlexionDeg(world, id))).toBeLessThan(0.01)
    }
  })
})

describe('JointTracker', () => {
  it('tracks ROM and angular velocity through a sweep', () => {
    // index PIP sweeps 0 → 90° over 2 s, holds, and returns.
    const { frames } = makeAngleFrames(
      (tMs) => {
        const up = Math.min(tMs / 2000, 1)
        const down = Math.max((tMs - 5000) / 2000, 0)
        return { index_pip: 90 * Math.max(up - down, 0) }
      },
      { durationMs: 8000 },
    )
    const tracker = new JointTracker()
    for (const f of frames) tracker.push(f)
    const s = tracker.summaries()

    expect(s.index_pip.maxDeg).toBeGreaterThan(85)
    expect(s.index_pip.minDeg).toBeLessThan(3)
    expect(s.index_pip.romDeg).toBeGreaterThan(83)
    // Ramp speed 45 °/s (EMA smoothing keeps the peak close to that).
    expect(s.index_pip.peakAngVelDegS).toBeGreaterThan(30)
    expect(s.index_pip.peakAngVelDegS).toBeLessThan(60)
    // An unmoved joint stays near zero ROM.
    expect(s.middle_mcp.romDeg).toBeLessThan(2)
  })

  it('reset clears accumulators but keeps tracking', () => {
    const { frames } = makeAngleFrames((tMs) => ({ index_pip: tMs < 1000 ? 60 : 5 }), {
      durationMs: 2000,
    })
    const tracker = new JointTracker()
    for (const f of frames.slice(0, 45)) tracker.push(f) // through the 60° phase
    tracker.reset()
    for (const f of frames.slice(45)) tracker.push(f)
    const s = tracker.summaries()
    expect(s.index_pip.maxDeg).toBeLessThan(30) // 60° phase forgotten
  })
})
