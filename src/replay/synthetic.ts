// Synthetic LandmarkFrame generators with exact ground truth. Frames are
// built event-first (closure times scheduled, then the signal interpolated
// between them with a raised-cosine profile), so tests can assert counts,
// timing, amplitudes, and decrement against known values.

import type { Hand, JointId, LandmarkFrame, Vec3 } from '../types'

export const SYNTH_ASPECT = 16 / 9
/** Wrist → middle-MCP distance of the template, meters (= height units). */
export const SYNTH_HAND_SCALE_M = 0.08

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rnd: () => number): () => number {
  return () => {
    const u = Math.max(rnd(), 1e-12)
    const v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

// Neutral right-hand template in a wrist-origin plane (meters, y down so the
// fingers point "up" in image space). |P0−P9| = 0.08 by construction.
const T = (x: number, y: number): Vec3 => ({ x, y, z: 0 })
export const HAND_TEMPLATE: readonly Vec3[] = [
  T(0, 0), // 0 wrist
  T(-0.03, -0.02), // 1 thumb cmc
  T(-0.055, -0.045), // 2 thumb mcp
  T(-0.07, -0.065), // 3 thumb ip
  T(-0.08, -0.08), // 4 thumb tip
  T(-0.025, -0.078), // 5 index mcp
  T(-0.03, -0.115), // 6 index pip
  T(-0.032, -0.14), // 7 index dip
  T(-0.034, -0.16), // 8 index tip
  T(0, -0.08), // 9 middle mcp
  T(0, -0.12), // 10 middle pip
  T(0, -0.15), // 11 middle dip
  T(0, -0.175), // 12 middle tip
  T(0.022, -0.077), // 13 ring mcp
  T(0.026, -0.115), // 14 ring pip
  T(0.028, -0.142), // 15 ring dip
  T(0.03, -0.165), // 16 ring tip
  T(0.042, -0.07), // 17 pinky mcp
  T(0.05, -0.1), // 18 pinky pip
  T(0.054, -0.12), // 19 pinky dip
  T(0.058, -0.14), // 20 pinky tip
]

/** World (meters, wrist origin) → frame. Image x is compressed by 1/aspect so
 *  aspect-corrected image distances equal world distances 1:1; image z uses
 *  MediaPipe's convention of being scaled like x. */
function toFrame(world: Vec3[], tMs: number, handedness: Hand): LandmarkFrame {
  const landmarks = world.map((w) => ({
    x: 0.5 + w.x / SYNTH_ASPECT,
    y: 0.55 + w.y,
    z: w.z / SYNTH_ASPECT,
  }))
  return { t: tMs, landmarks, world, handedness, score: 1, aspect: SYNTH_ASPECT }
}

function blankFrame(tMs: number): LandmarkFrame {
  return { t: tMs, landmarks: null, world: null, handedness: null, score: 0, aspect: SYNTH_ASPECT }
}

// ---------------------------------------------------------------------------
// Cycle-signal generators (tap and fist share the scheduling engine)

export interface CycleGenOpts {
  durationMs?: number
  fps?: number
  freqHz?: number
  /** Fully-open signal value, hand units. */
  openDist?: number
  /** Fully-closed signal value, hand units. */
  closedDist?: number
  /** Linear amplitude decline across events, % of the first amplitude. */
  decrementPct?: number
  /** Gaussian jitter on inter-closure intervals, % of the base interval. */
  itiJitterPct?: number
  /** Extra delay inserted into the interval containing atMs. */
  hesitations?: { atMs: number; extraMs: number }[]
  /** Gaussian noise on the signal, hand units. */
  noiseSd?: number
  /** Spans with no hand detected. */
  dropouts?: { atMs: number; durMs: number }[]
  seed?: number
  handedness?: Hand
}

export interface CycleGenTruth {
  count: number
  /** Scheduled closure (valley) times, ms. */
  eventTimesMs: number[]
  /** Per-event peak-to-valley amplitude, hand units. */
  amplitudes: number[]
  /** Scheduled inter-closure intervals, ms. */
  itis: number[]
}

export interface CycleGenResult {
  frames: LandmarkFrame[]
  truth: CycleGenTruth
}

interface Schedule {
  closures: number[]
  amplitudes: number[]
  base: number
  closed: number
}

function buildSchedule(o: Required<Omit<CycleGenOpts, 'hesitations' | 'dropouts'>> & CycleGenOpts): Schedule {
  const base = 1000 / o.freqHz
  const rnd = gaussian(mulberry32(o.seed))
  const pending = [...(o.hesitations ?? [])].sort((a, b) => a.atMs - b.atMs)
  const closures: number[] = []
  let tc = 0.75 * base
  while (tc <= o.durationMs - 0.25 * base) {
    closures.push(tc)
    let iti = base * (1 + (o.itiJitterPct / 100) * rnd())
    iti = Math.max(iti, 0.4 * base)
    while (pending.length > 0 && pending[0]!.atMs > tc && pending[0]!.atMs <= tc + iti) {
      iti += pending.shift()!.extraMs
    }
    tc += iti
  }
  const n = closures.length
  const full = o.openDist - o.closedDist
  const amplitudes = closures.map((_, k) =>
    n > 1 ? full * (1 - (o.decrementPct / 100) * (k / (n - 1))) : full,
  )
  return { closures, amplitudes, base, closed: o.closedDist }
}

/** Signal value at time t: raised-cosine arcs between scheduled closures. */
function signalAt(s: Schedule, tMs: number): number {
  const { closures, amplitudes, base, closed } = s
  const n = closures.length
  if (n === 0) return closed
  if (tMs >= closures[n - 1]!) {
    // Tail: open half-way and hold (plateau → no trailing peak detected).
    const u = Math.min((tMs - closures[n - 1]!) / base, 0.5)
    return closed + amplitudes[n - 1]! * (1 - Math.cos(2 * Math.PI * u)) * 0.5
  }
  // Find the interval [prev, next) containing tMs; before the first closure
  // use a virtual previous closure one base-interval earlier.
  let k = 0
  while (closures[k]! <= tMs) k++
  const next = closures[k]!
  const prev = k === 0 ? closures[0]! - base : closures[k - 1]!
  const u = (tMs - prev) / (next - prev)
  return closed + amplitudes[k]! * (1 - Math.cos(2 * Math.PI * u)) * 0.5
}

function withDefaults(o: CycleGenOpts, openDist: number, closedDist: number) {
  return {
    durationMs: o.durationMs ?? 10_000,
    fps: o.fps ?? 30,
    freqHz: o.freqHz ?? 2,
    openDist: o.openDist ?? openDist,
    closedDist: o.closedDist ?? closedDist,
    decrementPct: o.decrementPct ?? 0,
    itiJitterPct: o.itiJitterPct ?? 0,
    noiseSd: o.noiseSd ?? 0,
    seed: o.seed ?? 1,
    handedness: o.handedness ?? ('right' as Hand),
    hesitations: o.hesitations,
    dropouts: o.dropouts,
  }
}

function generate(
  o: ReturnType<typeof withDefaults>,
  apply: (d: number) => Vec3[],
): CycleGenResult {
  const sched = buildSchedule(o)
  const noise = gaussian(mulberry32(o.seed + 7919))
  const frames: LandmarkFrame[] = []
  const dt = 1000 / o.fps
  for (let tMs = 0; tMs < o.durationMs; tMs += dt) {
    const dropped = (o.dropouts ?? []).some((d) => tMs >= d.atMs && tMs < d.atMs + d.durMs)
    if (dropped) {
      frames.push(blankFrame(tMs))
      continue
    }
    const d = signalAt(sched, tMs) + o.noiseSd * noise()
    frames.push(toFrame(apply(Math.max(d, 0.01)), tMs, o.handedness))
  }
  const itis = sched.closures.slice(1).map((c, i) => c - sched.closures[i]!)
  return {
    frames,
    truth: {
      count: sched.closures.length,
      eventTimesMs: sched.closures,
      amplitudes: sched.amplitudes,
      itis,
    },
  }
}

/** Finger-tapping frames: thumb and index tips separated by d(t)·handScale
 *  along a fixed axis; everything else stays at the neutral template. */
export function makeTapFrames(opts: CycleGenOpts = {}): CycleGenResult {
  const o = withDefaults(opts, 1.0, 0.1)
  const t4 = HAND_TEMPLATE[4]!
  const t8 = HAND_TEMPLATE[8]!
  const mid = { x: (t4.x + t8.x) / 2, y: (t4.y + t8.y) / 2 }
  const axLen = Math.hypot(t8.x - t4.x, t8.y - t4.y)
  const ax = { x: (t8.x - t4.x) / axLen, y: (t8.y - t4.y) / axLen }
  return generate(o, (d) => {
    const world = HAND_TEMPLATE.map((p) => ({ ...p }))
    const half = (d * SYNTH_HAND_SCALE_M) / 2
    const tip4 = { x: mid.x - ax.x * half, y: mid.y - ax.y * half, z: 0 }
    const tip8 = { x: mid.x + ax.x * half, y: mid.y + ax.y * half, z: 0 }
    // Drag the adjacent joints along for visual plausibility.
    world[3] = {
      x: HAND_TEMPLATE[3]!.x + (tip4.x - t4.x) * 0.6,
      y: HAND_TEMPLATE[3]!.y + (tip4.y - t4.y) * 0.6,
      z: 0,
    }
    world[7] = {
      x: HAND_TEMPLATE[7]!.x + (tip8.x - t8.x) * 0.6,
      y: HAND_TEMPLATE[7]!.y + (tip8.y - t8.y) * 0.6,
      z: 0,
    }
    world[4] = tip4
    world[8] = tip8
    return world
  })
}

/** Fist open-close frames: the four fingertips slide along their wrist rays
 *  so mean fingertip distance equals a(t)·handScale exactly. */
export function makeFistFrames(opts: CycleGenOpts = {}): CycleGenResult {
  const o = withDefaults(opts, 2.2, 0.9)
  const chains: readonly (readonly [number, number, number])[] = [
    [6, 7, 8],
    [10, 11, 12],
    [14, 15, 16],
    [18, 19, 20],
  ]
  const tipDist = (tip: number) => Math.hypot(HAND_TEMPLATE[tip]!.x, HAND_TEMPLATE[tip]!.y)
  const meanTip = chains.reduce((s, c) => s + tipDist(c[2]), 0) / chains.length
  return generate(o, (a) => {
    const world = HAND_TEMPLATE.map((p) => ({ ...p }))
    for (const [pip, dip, tip] of chains) {
      const td = tipDist(tip)
      const dir = { x: HAND_TEMPLATE[tip]!.x / td, y: HAND_TEMPLATE[tip]!.y / td }
      const target = a * SYNTH_HAND_SCALE_M * (td / meanTip)
      world[tip] = { x: dir.x * target, y: dir.y * target, z: 0 }
      world[dip] = { x: dir.x * target * 0.8, y: dir.y * target * 0.8, z: 0 }
      world[pip] = { x: dir.x * target * 0.55, y: dir.y * target * 0.55, z: 0 }
    }
    return world
  })
}

// ---------------------------------------------------------------------------
// Joint-angle generator (forward kinematics)

const FINGER_CHAINS: Record<string, { joints: [JointId, JointId, JointId]; points: [number, number, number, number] }> = {
  thumb: { joints: ['thumb_cmc', 'thumb_mcp', 'thumb_ip'], points: [1, 2, 3, 4] },
  index: { joints: ['index_mcp', 'index_pip', 'index_dip'], points: [5, 6, 7, 8] },
  middle: { joints: ['middle_mcp', 'middle_pip', 'middle_dip'], points: [9, 10, 11, 12] },
  ring: { joints: ['ring_mcp', 'ring_pip', 'ring_dip'], points: [13, 14, 15, 16] },
  pinky: { joints: ['pinky_mcp', 'pinky_pip', 'pinky_dip'], points: [17, 18, 19, 20] },
}

function rot2(v: { x: number; y: number }, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180
  return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) }
}

/** Build a full hand where each finger chain is bent by the given flexion
 *  angles (degrees; 0 = straight). Angles not specified stay at 0 — note the
 *  template's neutral pose is replaced by straightened chains so measured
 *  flexion equals the requested flexion exactly. */
export function buildFlexedHand(flexions: Partial<Record<JointId, number>>): Vec3[] {
  const world = HAND_TEMPLATE.map((p) => ({ ...p }))
  for (const chain of Object.values(FINGER_CHAINS)) {
    const [p0, p1, p2, p3] = chain.points
    const base = HAND_TEMPLATE[p0]!
    const baseLen = Math.hypot(base.x, base.y)
    let dir = { x: base.x / baseLen, y: base.y / baseLen }
    const lens = [
      Math.hypot(HAND_TEMPLATE[p1]!.x - base.x, HAND_TEMPLATE[p1]!.y - base.y),
      Math.hypot(HAND_TEMPLATE[p2]!.x - HAND_TEMPLATE[p1]!.x, HAND_TEMPLATE[p2]!.y - HAND_TEMPLATE[p1]!.y),
      Math.hypot(HAND_TEMPLATE[p3]!.x - HAND_TEMPLATE[p2]!.x, HAND_TEMPLATE[p3]!.y - HAND_TEMPLATE[p2]!.y),
    ]
    let pos = { x: base.x, y: base.y }
    const pts = [p1, p2, p3]
    for (let i = 0; i < 3; i++) {
      dir = rot2(dir, flexions[chain.joints[i]!] ?? 0)
      pos = { x: pos.x + dir.x * lens[i]!, y: pos.y + dir.y * lens[i]! }
      world[pts[i]!] = { x: pos.x, y: pos.y, z: 0 }
    }
  }
  return world
}

export interface AngleGenOpts {
  durationMs?: number
  fps?: number
  handedness?: Hand
}

/** Frames where joint flexions follow `flexionsAt(tMs)`. */
export function makeAngleFrames(
  flexionsAt: (tMs: number) => Partial<Record<JointId, number>>,
  opts: AngleGenOpts = {},
): { frames: LandmarkFrame[] } {
  const durationMs = opts.durationMs ?? 8000
  const fps = opts.fps ?? 30
  const handedness = opts.handedness ?? 'right'
  const frames: LandmarkFrame[] = []
  for (let tMs = 0; tMs < durationMs; tMs += 1000 / fps) {
    frames.push(toFrame(buildFlexedHand(flexionsAt(tMs)), tMs, handedness))
  }
  return { frames }
}
