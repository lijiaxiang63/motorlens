// Landmark geometry → normalized 1-D movement signals.
//
// Movement signals are computed from MediaPipe *world* landmarks (metric 3-D
// coordinates): rigid rotation of the hand does not change 3-D distances, so
// palm tilt during tapping/clenching cannot modulate amplitudes the way it
// would with projected 2-D distances. Signals are divided by the world hand
// scale |W0−W9| (wrist to middle MCP) — "hand units" ≈ palm lengths — which
// also makes them independent of the person's hand size.
//
// Projected image-space distances remain in use for what they actually
// measure: framing (too close / too far gates) and positioning stability
// (quality reporting).

import { HAND_SCALE_MEDIAN_WINDOW } from '../config'
import { mean, median } from '../signal/stats'
import type { LandmarkFrame, Series, Vec3 } from '../types'

export const WRIST = 0
export const THUMB_TIP = 4
export const INDEX_TIP = 8
export const INDEX_MCP = 5
export const MIDDLE_MCP = 9
export const PINKY_MCP = 17
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

/** Projected hand size in image space — for the positioning-stability
 *  quality metric (and as the detected-frame filter's degeneracy guard). */
export function rawHandScale(landmarks: Vec3[], aspect: number): number {
  return dist2D(landmarks[WRIST]!, landmarks[MIDDLE_MCP]!, aspect)
}

/** Foreshortening-robust projected hand size for the framing gates: the
 *  larger of two roughly-orthogonal palm segments — palm length (wrist →
 *  middle MCP) and knuckle width (index MCP → pinky MCP). Whatever the hand
 *  orientation, at least one of the two stays substantially in the image
 *  plane: with the arm extended toward the camera the palm length collapses
 *  (≈3× foreshortened) but the knuckle line stays visible — gating on palm
 *  length alone falsely read that posture as "too far". For a hand facing
 *  the camera this equals rawHandScale (palm length > knuckle width), so
 *  facing-hand gate behavior is unchanged. */
export function gateHandScale(landmarks: Vec3[], aspect: number): number {
  return Math.max(
    dist2D(landmarks[WRIST]!, landmarks[MIDDLE_MCP]!, aspect),
    dist2D(landmarks[INDEX_MCP]!, landmarks[PINKY_MCP]!, aspect),
  )
}

/** Metric hand size from world landmarks (≈ constant for a given hand). */
export function worldHandScale(world: Vec3[]): number {
  return dist3D(world[WRIST]!, world[MIDDLE_MCP]!)
}

/** Centimeters per aspect-corrected image unit, from a least-squares fit of
 *  the world landmarks' IN-PLANE (x/y) coordinates onto the image landmarks
 *  across all 21 points (both centered; k = Σ î·ŵ / Σ |ŵ|² image units per
 *  meter, cm/unit = 100/k).
 *
 *  Foreshortening-robust: a hand pointing at the camera shrinks the image
 *  and world x/y spreads by the same factor, so the ratio survives — unlike
 *  a single projected segment (e.g. wrist→middle-MCP), whose world/image
 *  length ratio explodes as that segment aligns with the optical axis (the
 *  arm-extended-toward-camera tremor posture: several-fold cm inflation).
 *  Image noise averages out over the 21 points and is uncorrelated with ŵ,
 *  so the fit is unbiased where a spread RATIO would overestimate.
 *
 *  Returns null when the in-plane world spread is degenerate (never for a
 *  physical hand — landmarks cannot be collinear along the optical axis). */
export function fitCmPerImageUnit(
  landmarks: Vec3[],
  world: Vec3[],
  aspect: number,
): number | null {
  const n = Math.min(landmarks.length, world.length)
  if (n < 2) return null
  let mix = 0
  let miy = 0
  let mwx = 0
  let mwy = 0
  for (let j = 0; j < n; j++) {
    mix += landmarks[j]!.x * aspect
    miy += landmarks[j]!.y
    mwx += world[j]!.x
    mwy += world[j]!.y
  }
  mix /= n
  miy /= n
  mwx /= n
  mwy /= n
  let dot = 0
  let ww = 0
  for (let j = 0; j < n; j++) {
    const ix = landmarks[j]!.x * aspect - mix
    const iy = landmarks[j]!.y - miy
    const wx = world[j]!.x - mwx
    const wy = world[j]!.y - mwy
    dot += ix * wx + iy * wy
    ww += wx * wx + wy * wy
  }
  if (ww < 1e-10 || dot <= 0) return null
  return (100 * ww) / dot
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

/** Thumb-tip ↔ index-tip separation (finger tapping), meters (world). */
export function tapRaw(world: Vec3[]): number {
  return dist3D(world[THUMB_TIP]!, world[INDEX_TIP]!)
}

/** Mean fingertip-to-wrist distance (hand aperture), meters (world). */
export function apertureRaw(world: Vec3[]): number {
  let s = 0
  for (const tip of APERTURE_TIPS) s += dist3D(world[tip]!, world[WRIST]!)
  return s / APERTURE_TIPS.length
}

/** Fingertips that stay extended during tapping (index excluded — it moves). */
export const REST_TIPS = [12, 16, 20] as const

/** Mean middle/ring/pinky-tip-to-wrist distance, meters (world). Oscillates
 *  during fist open–close but stays ~constant during finger tapping, which is
 *  what separates the two movements in uploaded-video classification. */
export function restRaw(world: Vec3[]): number {
  let s = 0
  for (const tip of REST_TIPS) s += dist3D(world[tip]!, world[WRIST]!)
  return s / REST_TIPS.length
}

export interface ExtractedSignal {
  /** Normalized signal sampled at detected frames only. */
  series: Series
  /** Projected image-space hand-scale per detected frame (quality only). */
  rawScales: number[]
  /** Centimeters per hand unit from world landmarks, null if unavailable. */
  cmPerUnit: number | null
}

export function extractSignal(
  frames: LandmarkFrame[],
  raw: (world: Vec3[]) => number,
): ExtractedSignal {
  const t: number[] = []
  const v: number[] = []
  const rawScales: number[] = []
  const worldScales: number[] = []
  const smoother = new ScaleSmoother()
  for (const f of frames) {
    if (!f.landmarks || !f.world) continue
    const ws = worldHandScale(f.world)
    if (ws < 1e-6) continue
    rawScales.push(rawHandScale(f.landmarks, f.aspect))
    worldScales.push(ws)
    const scale = smoother.push(ws)
    t.push(f.t)
    v.push(raw(f.world) / scale)
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
