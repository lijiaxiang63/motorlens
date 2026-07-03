import { describe, expect, it } from 'vitest'
import { rawHandScale } from '../metrics/kinematics'
import { makePronosupFrames, makeTapFrames } from '../replay/synthetic'
import type { LandmarkFrame } from '../types'
import { TestSession, type Phase } from './testSession'

function blank(t: number): LandmarkFrame {
  return { t, landmarks: null, world: null, handedness: null, score: 0, aspect: 16 / 9 }
}

describe('TestSession', () => {
  it('walks positioning → countdown → recording → done on good frames', () => {
    const { frames } = makeTapFrames({ durationMs: 16_000 })
    const session = new TestSession(10_000, 'right')
    const seen: Phase['kind'][] = []
    session.subscribe((p) => {
      if (seen[seen.length - 1] !== p.kind) seen.push(p.kind)
    })
    for (const f of frames) session.onFrame(f)

    expect(seen).toEqual(['positioning', 'countdown', 'recording', 'done'])
    const done = session.current
    expect(done.kind).toBe('done')
    if (done.kind === 'done') {
      const span = done.frames[done.frames.length - 1]!.t - done.frames[0]!.t
      expect(span).toBeGreaterThanOrEqual(10_000)
      expect(span).toBeLessThan(10_200)
      // Recording starts after ~1 s gate window + 3 s countdown.
      expect(done.frames[0]!.t).toBeGreaterThan(3_900)
      expect(done.frames[0]!.t).toBeLessThan(4_600)
    }
  })

  it('holds at positioning with wrong_hand when the other hand shows', () => {
    const { frames } = makeTapFrames({ durationMs: 3_000, handedness: 'left' })
    const session = new TestSession(10_000, 'right')
    for (const f of frames) session.onFrame(f)
    const p = session.current
    expect(p.kind).toBe('positioning')
    if (p.kind === 'positioning') expect(p.issues).toContain('wrong_hand')
  })

  it('falls back to positioning when the hand disappears mid-countdown', () => {
    const { frames } = makeTapFrames({ durationMs: 4_000 })
    const session = new TestSession(10_000, 'right')
    // Enough frames to pass the gates and enter countdown (~1 s + margin).
    for (const f of frames.slice(0, 45)) session.onFrame(f)
    expect(session.current.kind).toBe('countdown')
    // 700 ms of no hand (> 500 ms tolerance) starting at t≈1.5 s.
    for (let t = 1500; t < 2200; t += 33) session.onFrame(blank(t))
    expect(session.current.kind).toBe('positioning')
  })

  it('keeps recording through tracking loss', () => {
    const { frames } = makeTapFrames({
      durationMs: 16_000,
      dropouts: [{ atMs: 7_000, durMs: 1_000 }],
    })
    const session = new TestSession(10_000, 'right')
    for (const f of frames) session.onFrame(f)
    expect(session.current.kind).toBe('done')
  })

  it('passes the framing gate with the arm extended toward the camera', () => {
    const { frames } = makePronosupFrames({ posture: 'forward', durationMs: 16_000 })
    // Premise of the regression: the palm length alone is ~3× foreshortened
    // in this posture — its mean sits below the 0.06 floor, so a gate
    // measuring only |P0−P9| held the clinical arm-extended posture at
    // 'too_far' forever. The knuckle line keeps gateHandScale in range.
    const detected = frames.filter((f) => f.landmarks)
    const palmMean =
      detected.reduce((s, f) => s + rawHandScale(f.landmarks!, f.aspect), 0) / detected.length
    expect(palmMean).toBeLessThan(0.06)

    const session = new TestSession(10_000, 'right')
    for (const f of frames) session.onFrame(f)
    expect(session.current.kind).toBe('done')
  })

  it('honors a per-test hand-scale range', () => {
    const { frames } = makeTapFrames({ durationMs: 3_000 })
    const strict = new TestSession(10_000, 'right', [0.2, 0.5])
    for (const f of frames) strict.onFrame(f)
    const p = strict.current
    expect(p.kind).toBe('positioning')
    if (p.kind === 'positioning') expect(p.issues).toContain('too_far')

    const close = new TestSession(10_000, 'right', [0.01, 0.05])
    for (const f of frames) close.onFrame(f)
    const q = close.current
    expect(q.kind).toBe('positioning')
    if (q.kind === 'positioning') expect(q.issues).toContain('too_close')
  })

  it('cancel is terminal', () => {
    const { frames } = makeTapFrames({ durationMs: 2_000 })
    const session = new TestSession(10_000, 'right')
    session.cancel()
    for (const f of frames) session.onFrame(f)
    expect(session.current.kind).toBe('cancelled')
  })
})
