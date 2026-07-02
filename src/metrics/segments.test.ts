import { describe, expect, it } from 'vitest'
import { makeFistFrames, makeTapFrames, mulberry32, SYNTH_ASPECT } from '../replay/synthetic'
import type { Hand, LandmarkFrame } from '../types'
import { detectSegments, sliceFrames, swapFramesHandedness } from './segments'

const FPS = 30
const DT = 1000 / FPS

function blank(tMs: number): LandmarkFrame {
  return { t: tMs, landmarks: null, world: null, handedness: null, score: 0, aspect: SYNTH_ASPECT }
}

/** Lay parts on one timeline, separated by gaps of blank frames — the shape
 *  an uploaded video produces (one frame per step, blank when no hand). */
function compose(parts: { frames: LandmarkFrame[]; gapAfterMs?: number }[]): LandmarkFrame[] {
  const out: LandmarkFrame[] = []
  let offset = 0
  for (const part of parts) {
    for (const f of part.frames) out.push({ ...f, t: f.t + offset })
    const last = out[out.length - 1]!.t
    offset = last + DT
    for (let g = 0; g < (part.gapAfterMs ?? 0); g += DT) {
      out.push(blank(offset))
      offset += DT
    }
  }
  return out
}

describe('detectSegments on composed synthetic ground truth', () => {
  it('separates a left-hand tap block from a right-hand fist block', () => {
    const tap = makeTapFrames({ handedness: 'left', durationMs: 8000 })
    const fist = makeFistFrames({ handedness: 'right', durationMs: 8000, freqHz: 1.5 })
    const frames = compose([{ frames: tap.frames, gapAfterMs: 2000 }, { frames: fist.frames }])
    const segs = detectSegments(frames)

    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ hand: 'left', testId: 'finger_tap' })
    expect(segs[1]).toMatchObject({ hand: 'right', testId: 'fist_open_close' })
    expect(Math.abs(segs[0]!.startMs - 0)).toBeLessThan(1200)
    expect(Math.abs(segs[0]!.endMs - 8000)).toBeLessThan(1200)
    expect(Math.abs(segs[1]!.startMs - 10000)).toBeLessThan(1200)
    expect(Math.abs(segs[1]!.endMs - 18000)).toBeLessThan(1200)
    expect(segs[0]!.confidence).toBeGreaterThan(0.9)
    expect(segs[1]!.confidence).toBeGreaterThan(0.9)
  })

  it('splits tap → fist of the same hand at the movement change', () => {
    const tap = makeTapFrames({ handedness: 'right', durationMs: 8000 })
    const fist = makeFistFrames({ handedness: 'right', durationMs: 8000, freqHz: 1.5 })
    const frames = compose([{ frames: tap.frames }, { frames: fist.frames }])
    const segs = detectSegments(frames)

    expect(segs).toHaveLength(2)
    expect(segs[0]!.testId).toBe('finger_tap')
    expect(segs[1]!.testId).toBe('fist_open_close')
    // Transition at ~8000 ms; window quantization allows some slack.
    expect(Math.abs(segs[0]!.endMs - 8000)).toBeLessThan(1200)
    expect(Math.abs(segs[1]!.startMs - 8000)).toBeLessThan(1200)
    expect(segs[0]!.confidence).toBeGreaterThan(0.6)
  })

  it('reports nothing for a visible but motionless hand', () => {
    const still = makeTapFrames({ openDist: 1, closedDist: 1, durationMs: 8000 })
    expect(detectSegments(still.frames)).toEqual([])
  })

  it('drops blips shorter than the minimum segment duration', () => {
    const blip = makeTapFrames({ durationMs: 2000 })
    expect(detectSegments(blip.frames)).toEqual([])
  })

  it('survives sporadic handedness mislabels via majority vote', () => {
    const tap = makeTapFrames({ handedness: 'left', durationMs: 8000 })
    const rnd = mulberry32(42)
    const flipped = tap.frames.map((f) =>
      f.handedness !== null && rnd() < 0.1
        ? { ...f, handedness: (f.handedness === 'left' ? 'right' : 'left') as Hand }
        : f,
    )
    const segs = detectSegments(flipped)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ hand: 'left', testId: 'finger_tap' })
    expect(segs[0]!.endMs - segs[0]!.startMs).toBeGreaterThan(6000)
  })

  it('merges one task across a mid-task tracking dropout', () => {
    const tap = makeTapFrames({ durationMs: 10000, dropouts: [{ atMs: 4000, durMs: 1500 }] })
    const segs = detectSegments(tap.frames)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ hand: 'right', testId: 'finger_tap' })
    expect(segs[0]!.startMs).toBeLessThan(1200)
    expect(segs[0]!.endMs).toBeGreaterThan(8800)
  })
})

describe('sliceFrames / swapFramesHandedness', () => {
  it('keeps the time base and blanks other-hand frames', () => {
    const tap = makeTapFrames({ handedness: 'left', durationMs: 4000 })
    const fist = makeFistFrames({ handedness: 'right', durationMs: 4000 })
    const frames = compose([{ frames: tap.frames, gapAfterMs: 1000 }, { frames: fist.frames }])
    const all = { startMs: 0, endMs: frames[frames.length - 1]!.t, hand: 'left' as Hand }
    const slice = sliceFrames(frames, all)

    expect(slice).toHaveLength(frames.length)
    expect(slice.map((f) => f.t)).toEqual(frames.map((f) => f.t))
    const detectedLeft = slice.filter((f) => f.landmarks !== null)
    expect(detectedLeft).toHaveLength(tap.frames.filter((f) => f.landmarks !== null).length)
    expect(detectedLeft.every((f) => f.handedness === 'left')).toBe(true)
    // Right-hand fist frames became blanks, not omissions.
    const fistRegion = slice.filter((f) => f.t > 5000)
    expect(fistRegion.length).toBeGreaterThan(0)
    expect(fistRegion.every((f) => f.landmarks === null)).toBe(true)
  })

  it('clips to the segment bounds', () => {
    const tap = makeTapFrames({ handedness: 'right', durationMs: 6000 })
    const slice = sliceFrames(tap.frames, { startMs: 2000, endMs: 4000, hand: 'right' })
    expect(slice[0]!.t).toBeGreaterThanOrEqual(2000)
    expect(slice[slice.length - 1]!.t).toBeLessThanOrEqual(4000)
    expect(slice.every((f) => f.landmarks !== null)).toBe(true)
  })

  it('swapFramesHandedness flips labels and round-trips', () => {
    const tap = makeTapFrames({ handedness: 'left', durationMs: 2000, dropouts: [{ atMs: 500, durMs: 200 }] })
    const swapped = swapFramesHandedness(tap.frames)
    expect(swapped.filter((f) => f.handedness !== null).every((f) => f.handedness === 'right')).toBe(true)
    expect(swapFramesHandedness(swapped).map((f) => f.handedness)).toEqual(
      tap.frames.map((f) => f.handedness),
    )
  })
})
