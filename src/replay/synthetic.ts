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

export interface PronosupGenOpts extends CycleGenOpts {
  /** Extra constant roll added to every frame, degrees. The default keeps
   *  the measured roll inside (−180, 180]; pass e.g. 100 to force the
   *  wrapped signal across the ±180° boundary (unwrap stress test). */
  rollOffsetDeg?: number
  /** 'upright' (default): forearm vertical, elbow-on-table — rotation about
   *  the camera's y axis. 'forward': arm extended toward the camera —
   *  rotation about the forearm axis, which sits tiltDeg off the optical
   *  axis (the camera slightly above/below the hand, as instructed). */
  posture?: 'upright' | 'forward'
  /** Forward posture only: forearm angle off the optical axis, degrees. */
  tiltDeg?: number
}

/** Pronation-supination frames: the whole neutral template rigidly rotated
 *  about its own long axis (template y) through the wrist, then — in the
 *  'forward' posture — the whole arm tipped toward the camera about x.
 *  W9 = (0, −0.08, 0) lies on the rotation axis, so |W0−W9| is preserved
 *  exactly in world space (and rawHandScale stays constant per posture) —
 *  hand scale cannot leak into the measured amplitude.
 *
 *  Geometry: in BOTH postures the measured roll is 40 + d (+ rollOffsetDeg)
 *  exactly (upright: roll = −θ with θ = −(40+d+offset); forward: roll =
 *  180° − θ with θ = 140−d−offset, independent of tiltDeg). Schedule
 *  closures (d minima) are therefore roll MINIMA, aligning detected events
 *  with truth.eventTimesMs, and peak-to-valley roll amplitude equals the
 *  scheduled amplitude in degrees exactly. Defaults d ∈ [10, 90] →
 *  roll ∈ [50, 130]°, safely away from the ±180° wrap and the generate()
 *  positivity clamp. */
export function makePronosupFrames(opts: PronosupGenOpts = {}): CycleGenResult {
  const o = withDefaults(opts, 90, 10)
  const offset = opts.rollOffsetDeg ?? 0
  if ((opts.posture ?? 'upright') === 'forward') {
    // Tip angle from upright: 90° − tilt-off-optical-axis.
    const alpha = ((90 - (opts.tiltDeg ?? 20)) * Math.PI) / 180
    const ca = Math.cos(alpha)
    const sa = Math.sin(alpha)
    return generate(o, (d) => {
      const theta = ((140 - d - offset) * Math.PI) / 180
      const ct = Math.cos(theta)
      const st = Math.sin(theta)
      return HAND_TEMPLATE.map((p) => {
        // Roll about the template's own long axis (y)…
        const x = p.x * ct + p.z * st
        const z = -p.x * st + p.z * ct
        // …then tip the whole arm toward the camera (about x).
        return { x, y: p.y * ca - z * sa, z: p.y * sa + z * ca }
      })
    })
  }
  return generate(o, (d) => {
    const theta = (-(40 + d + offset) * Math.PI) / 180
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    return HAND_TEMPLATE.map((p) => ({
      x: p.x * cos + p.z * sin,
      y: p.y,
      z: -p.x * sin + p.z * cos,
    }))
  })
}

export interface TremorGenOpts {
  /** Primary tremor tone. */
  freqHz?: number
  /** Peak displacement of the primary tone, cm. 0 = no tremor. */
  ampCm?: number
  /** Direction of the oscillation in the image plane, degrees from +x. */
  axisDeg?: number
  /** Optional second tone (two-tone spectra). */
  secondary?: { freqHz: number; ampCm: number }
  /** Slow postural drift (a tremor-free hand sways below the band). */
  drift?: { freqHz: number; ampCm: number }
  /** Pill-rolling component (rest tremor): thumb and index TIPS oscillate
   *  symmetrically along their separation axis so the world thumb–index
   *  distance swings by ±ampCm — strictly invisible to the palm centroid
   *  [0,5,9,13,17], which excludes both fingertips. */
  finger?: { freqHz: number; ampCm: number }
  /** White noise per axis, cm. */
  noiseSdCm?: number
  /** 'facing' (default): flat hand facing the camera. 'forward': the
   *  postural-tremor posture — arm extended toward the camera, the whole
   *  hand tipped so it sits tiltDeg off the optical axis. The wrist→
   *  middle-MCP segment foreshortens in image space while the true hand
   *  size is unchanged, which used to inflate the projected-segment cm
   *  conversion several-fold. */
  posture?: 'facing' | 'forward'
  /** Forward posture only: hand angle off the optical axis, degrees. */
  tiltDeg?: number
  durationMs?: number
  fps?: number
  dropouts?: { atMs: number; durMs: number }[]
  seed?: number
  handedness?: Hand
}

export interface TremorGenResult {
  frames: LandmarkFrame[]
  truth: { freqHz: number; ampCm: number; rmsCm: number }
}

/** Tremor frames: the WORLD landmarks stay an untranslated rigid template
 *  (hand-centered, exactly like real MediaPipe world coordinates — whole-hand
 *  translation is invisible there); only the projected image landmarks
 *  translate. Displacement is defined in aspect-corrected image units, and
 *  the image landmarks are an exact in-plane copy of the world x/y (1 unit =
 *  1 m = 100 cm), so the analyzer's least-squares cm conversion recovers
 *  ampCm exactly — in the 'forward' posture too, where the projected
 *  wrist→middle-MCP segment shrinks ~3× and a segment-ratio conversion
 *  would inflate cm by the same factor. truth.rmsCm covers primary +
 *  secondary tones (each tone contributes amp²/2 to the variance). */
export function makeTremorFrames(opts: TremorGenOpts = {}): TremorGenResult {
  const freqHz = opts.freqHz ?? 5
  const ampCm = opts.ampCm ?? 0.8
  const axis = ((opts.axisDeg ?? 25) * Math.PI) / 180
  const durationMs = opts.durationMs ?? 15_000
  const fps = opts.fps ?? 30
  const noiseSdCm = opts.noiseSdCm ?? 0
  const handedness = opts.handedness ?? ('right' as Hand)
  const noise = gaussian(mulberry32((opts.seed ?? 1) + 104_729))
  // Tip angle from upright: 0 for the flat facing template, 90° − tilt for
  // the arm-extended-toward-camera posture (same convention as pron-sup).
  const alpha =
    (opts.posture ?? 'facing') === 'forward' ? ((90 - (opts.tiltDeg ?? 20)) * Math.PI) / 180 : 0
  const ca = Math.cos(alpha)
  const sa = Math.sin(alpha)
  const world = HAND_TEMPLATE.map((p) => ({ x: p.x, y: p.y * ca - p.z * sa, z: p.y * sa + p.z * ca }))
  const frames: LandmarkFrame[] = []
  const dt = 1000 / fps
  for (let tMs = 0; tMs < durationMs; tMs += dt) {
    const dropped = (opts.dropouts ?? []).some((d) => tMs >= d.atMs && tMs < d.atMs + d.durMs)
    if (dropped) {
      frames.push(blankFrame(tMs))
      continue
    }
    const tS = tMs / 1000
    let s = ampCm * Math.sin(2 * Math.PI * freqHz * tS)
    if (opts.secondary) s += opts.secondary.ampCm * Math.sin(2 * Math.PI * opts.secondary.freqHz * tS)
    if (opts.drift) s += opts.drift.ampCm * Math.sin(2 * Math.PI * opts.drift.freqHz * tS)
    // Pill-rolling: displace tips 4 and 8 by ∓half the separation swing so
    // |W4−W8| changes by finger.ampCm·sin(·) cm exactly (world AND image).
    let w = world
    if (opts.finger) {
      const half = ((opts.finger.ampCm / 2) * Math.sin(2 * Math.PI * opts.finger.freqHz * tS)) / 100
      w = world.map((p) => ({ ...p }))
      const t4 = w[4]!
      const t8 = w[8]!
      const sx = t8.x - t4.x
      const sy = t8.y - t4.y
      const sz = t8.z - t4.z
      const len = Math.hypot(sx, sy, sz)
      w[4] = { x: t4.x - (sx / len) * half, y: t4.y - (sy / len) * half, z: t4.z - (sz / len) * half }
      w[8] = { x: t8.x + (sx / len) * half, y: t8.y + (sy / len) * half, z: t8.z + (sz / len) * half }
    }
    // Aspect-corrected image-unit displacement (1 unit = 100 cm here).
    const dx = (s * Math.cos(axis) + noiseSdCm * noise()) / 100
    const dy = (s * Math.sin(axis) + noiseSdCm * noise()) / 100
    const landmarks = w.map((p) => ({
      x: 0.5 + (p.x + dx) / SYNTH_ASPECT,
      y: 0.55 + p.y + dy,
      z: p.z / SYNTH_ASPECT,
    }))
    frames.push({ t: tMs, landmarks, world: w, handedness, score: 1, aspect: SYNTH_ASPECT })
  }
  const secondaryVar = opts.secondary ? opts.secondary.ampCm ** 2 / 2 : 0
  const fingerVar = opts.finger ? opts.finger.ampCm ** 2 / 2 : 0
  return {
    frames,
    // Combined-channel RMS: each tone contributes amp²/2 to the variance
    // (the finger tone only when the analyzer's finger channel is on).
    truth: { freqHz, ampCm, rmsCm: Math.sqrt(ampCm ** 2 / 2 + secondaryVar + fingerVar) },
  }
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

/** Full-hand sweep maxima shared by the angles-sweep monitor preset, the
 *  timed-ROM preset, and the ROM ground-truth suite. Total: 890°. */
export const ROM_SWEEP_FLEXIONS: Partial<Record<JointId, number>> = {
  index_mcp: 50,
  index_pip: 95,
  index_dip: 60,
  middle_mcp: 50,
  middle_pip: 95,
  middle_dip: 60,
  ring_mcp: 45,
  ring_pip: 90,
  ring_dip: 55,
  pinky_mcp: 45,
  pinky_pip: 85,
  pinky_dip: 55,
  thumb_cmc: 20,
  thumb_mcp: 35,
  thumb_ip: 50,
}

export interface RomSweepOpts {
  /** Scheduled per-joint flexion maxima, degrees (exact FK ground truth). */
  flexions?: Partial<Record<JointId, number>>
  /** Full open→close→open sweep period. */
  cycleMs?: number
  durationMs?: number
  fps?: number
  handedness?: Hand
  dropouts?: { atMs: number; durMs: number }[]
}

export interface RomSweepResult {
  frames: LandmarkFrame[]
  truth: { maxFlexions: Partial<Record<JointId, number>> }
}

/** Timed-ROM sweep: every scheduled joint flexes 0 → max → 0 on a raised
 *  cosine. buildFlexedHand's forward kinematics is exact, so each joint's
 *  scheduled maximum IS the ground-truth ROM (the phase hits exactly 1 at
 *  cycleMs/2, which lands on a sample at the default 30 fps / 4 s cycle). */
export function makeRomSweepFrames(opts: RomSweepOpts = {}): RomSweepResult {
  const flexions = opts.flexions ?? ROM_SWEEP_FLEXIONS
  const cycleMs = opts.cycleMs ?? 4_000
  const durationMs = opts.durationMs ?? 10_000
  const fps = opts.fps ?? 30
  const handedness = opts.handedness ?? ('right' as Hand)
  const frames: LandmarkFrame[] = []
  const dt = 1000 / fps
  for (let tMs = 0; tMs < durationMs; tMs += dt) {
    const dropped = (opts.dropouts ?? []).some((d) => tMs >= d.atMs && tMs < d.atMs + d.durMs)
    if (dropped) {
      frames.push(blankFrame(tMs))
      continue
    }
    const phase = (1 - Math.cos((2 * Math.PI * tMs) / cycleMs)) / 2
    const scaled: Partial<Record<JointId, number>> = {}
    for (const [id, deg] of Object.entries(flexions)) {
      scaled[id as JointId] = deg * phase
    }
    frames.push(toFrame(buildFlexedHand(scaled), tMs, handedness))
  }
  return { frames, truth: { maxFlexions: flexions } }
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
