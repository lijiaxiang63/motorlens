// Landmark geometry → normalized 1-D movement signals.
//
// All distances are divided by the hand scale |P0−P9| (wrist to middle MCP)
// measured in aspect-corrected image units, so signals are invariant to how
// far the hand is from the camera. "Hand units" ≈ multiples of palm length.

import { HAND_SCALE_MEDIAN_WINDOW } from '../config'
import { mean, median } from '../signal/stats'
import type { LandmarkFrame, Series, Vec3 } from '../types'

export const WRIST = 0
export const THUMB_TIP = 4
export const INDEX_TIP = 8
export const MIDDLE_MCP = 9
/** Aperture fingertips (thumb excluded). */
export const APERTURE_TIPS = [8, 12, 16, 20] as const

/** 2-D distance in height units: x is stretched by the frame aspect ratio so
 *  horizontal and vertical distances are commensurable. */
export function dist2D(a: Vec3, b: Vec3, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y)
}

export function dist3D(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function rawHandScale(landmarks: Vec3[], aspect: number): number {
  return dist2D(landmarks[WRIST]!, landmarks[MIDDLE_MCP]!, aspect)
}

/** Trailing-median smoother for the hand-scale divisor (robust to blips). */
export class ScaleSmoother {
  private buf: number[] = []

  push(raw: number): number {
    this.buf.push(raw)
    if (this.buf.length > HAND_SCALE_MEDIAN_WINDOW) this.buf.shift()
    return median(this.buf)
  }

  reset(): void {
    this.buf = []
  }
}

/** Thumb-tip ↔ index-tip separation (finger tapping), height units. */
export function tapRaw(lm: Vec3[], aspect: number): number {
  return dist2D(lm[THUMB_TIP]!, lm[INDEX_TIP]!, aspect)
}

/** Mean fingertip-to-wrist distance (hand aperture), height units. */
export function apertureRaw(lm: Vec3[], aspect: number): number {
  let s = 0
  for (const tip of APERTURE_TIPS) s += dist2D(lm[tip]!, lm[WRIST]!, aspect)
  return s / APERTURE_TIPS.length
}

export interface ExtractedSignal {
  /** Normalized signal sampled at detected frames only. */
  series: Series
  /** Raw (unsmoothed) hand-scale values per detected frame. */
  rawScales: number[]
  /** Centimeters per hand unit from world landmarks, null if unavailable. */
  cmPerUnit: number | null
}

export function extractSignal(
  frames: LandmarkFrame[],
  raw: (lm: Vec3[], aspect: number) => number,
): ExtractedSignal {
  const t: number[] = []
  const v: number[] = []
  const rawScales: number[] = []
  const worldScales: number[] = []
  const smoother = new ScaleSmoother()
  for (const f of frames) {
    if (!f.landmarks) continue
    const rs = rawHandScale(f.landmarks, f.aspect)
    if (rs < 1e-6) continue
    rawScales.push(rs)
    const scale = smoother.push(rs)
    t.push(f.t)
    v.push(raw(f.landmarks, f.aspect) / scale)
    if (f.world) worldScales.push(dist3D(f.world[WRIST]!, f.world[MIDDLE_MCP]!))
  }
  return {
    series: { t, v },
    rawScales,
    cmPerUnit: worldScales.length > 0 ? mean(worldScales) * 100 : null,
  }
}

/** Split a series wherever consecutive samples are more than maxGapMs apart
 *  (tracking dropouts) so no analysis runs across the gap. */
export function splitSeries(s: Series, maxGapMs: number): Series[] {
  const out: Series[] = []
  let start = 0
  for (let i = 1; i <= s.t.length; i++) {
    if (i === s.t.length || s.t[i]! - s.t[i - 1]! > maxGapMs) {
      if (i > start) out.push({ t: s.t.slice(start, i), v: s.v.slice(start, i) })
      start = i
    }
  }
  return out
}
