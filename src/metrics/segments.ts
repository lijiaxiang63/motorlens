// Auto-segmentation of an uploaded recording into per-hand, per-movement
// test segments. Pure and DOM-free; thresholds live in config.ts and the
// ground-truth suite in segments.test.ts locks the behavior down.
//
// Pipeline: majority-vote handedness smoothing → presence runs (split at
// detection gaps or hand changes) → sliding-window tap/fist classification →
// label merge with boundary resolution → duration filter + confidence.
//
// Classification insight: during finger tapping the middle/ring/pinky stay
// extended (restRaw ~flat) while thumb–index oscillates; during fist
// open–close every finger moves. The fist rule is checked FIRST because the
// thumb–index distance oscillates during fists too (only the thumb is still).

import {
  SEG_CLASSIFY_HOP_MS,
  SEG_CLASSIFY_WINDOW_MS,
  SEG_FIST_OSC_MIN,
  SEG_GAP_SPLIT_MS,
  SEG_MERGE_GAP_MS,
  SEG_MIN_SEGMENT_MS,
  SEG_MIN_WINDOW_SAMPLES,
  SEG_TAP_OSC_MIN,
  SEG_VOTE_WINDOW,
} from '../config'
import { percentile } from '../signal/stats'
import type { Hand, LandmarkFrame } from '../types'
import { restRaw, tapRaw, worldHandScale } from './kinematics'

export interface DetectedSegment {
  startMs: number
  endMs: number
  hand: Hand
  testId: 'finger_tap' | 'fist_open_close'
  /** min(handedness purity, classifier window agreement), 0..1. */
  confidence: number
}

type Label = 'tap' | 'fist' | 'idle'

interface Run {
  hand: Hand
  frames: LandmarkFrame[] // detected frames only, time-ordered
}

interface Window {
  centerMs: number
  label: Label
}

interface Span {
  startMs: number
  endMs: number
  hand: Hand
  label: 'tap' | 'fist'
}

/** Majority-vote handedness over a trailing window of detected frames —
 *  MediaPipe's label flickers on ambiguous poses. */
function smoothedHands(detected: LandmarkFrame[]): Hand[] {
  const out: Hand[] = []
  let left = 0
  let right = 0
  for (let i = 0; i < detected.length; i++) {
    if (detected[i]!.handedness === 'left') left++
    else right++
    const drop = i - SEG_VOTE_WINDOW
    if (drop >= 0) {
      if (detected[drop]!.handedness === 'left') left--
      else right--
    }
    if (left > right) out.push('left')
    else if (right > left) out.push('right')
    else out.push(out[i - 1] ?? (detected[i]!.handedness as Hand))
  }
  return out
}

function buildRuns(frames: LandmarkFrame[]): Run[] {
  const detected = frames.filter((f) => f.landmarks !== null && f.handedness !== null)
  if (detected.length === 0) return []
  const hands = smoothedHands(detected)
  const runs: Run[] = []
  let start = 0
  for (let i = 1; i <= detected.length; i++) {
    const boundary =
      i === detected.length ||
      detected[i]!.t - detected[i - 1]!.t > SEG_GAP_SPLIT_MS ||
      hands[i] !== hands[i - 1]
    if (boundary) {
      const slice = detected.slice(start, i)
      const span = slice[slice.length - 1]!.t - slice[0]!.t
      // Runs too short to hold even a half classification window carry no
      // usable signal (handedness blips, edge flicker). The full minimum
      // segment duration is enforced later, AFTER merging — so a pause that
      // splits one task into short runs still yields one segment.
      if (span >= SEG_CLASSIFY_WINDOW_MS / 2) {
        runs.push({ hand: hands[start]!, frames: slice })
      }
      start = i
    }
  }
  return runs
}

/** Sliding-window movement classification within one presence run. */
function classifyRun(run: Run): Window[] {
  const t0 = run.frames[0]!.t
  const t1 = run.frames[run.frames.length - 1]!.t
  const windows: Window[] = []
  for (let ws = t0; ws < t1; ws += SEG_CLASSIFY_HOP_MS) {
    const we = Math.min(ws + SEG_CLASSIFY_WINDOW_MS, t1)
    if (we - ws < SEG_CLASSIFY_WINDOW_MS / 2) break
    const tapN: number[] = []
    const restN: number[] = []
    for (const f of run.frames) {
      if (f.t < ws || f.t > we || !f.world) continue
      const scale = worldHandScale(f.world)
      if (scale < 1e-6) continue
      tapN.push(tapRaw(f.world) / scale)
      restN.push(restRaw(f.world) / scale)
    }
    let label: Label = 'idle'
    if (tapN.length >= SEG_MIN_WINDOW_SAMPLES) {
      const tapOsc = percentile(tapN, 90) - percentile(tapN, 10)
      const restOsc = percentile(restN, 90) - percentile(restN, 10)
      if (restOsc >= SEG_FIST_OSC_MIN) label = 'fist'
      else if (tapOsc >= SEG_TAP_OSC_MIN) label = 'tap'
    }
    windows.push({ centerMs: (ws + we) / 2, label })
    if (we >= t1) break
  }
  return windows
}

/** RLE the window labels of one run into active spans; the boundary between
 *  adjacent different-label groups is the midpoint of their edge windows. */
function runSpans(run: Run, windows: Window[]): Span[] {
  const t0 = run.frames[0]!.t
  const t1 = run.frames[run.frames.length - 1]!.t
  const groups: { label: Label; from: number; to: number }[] = []
  for (let i = 0; i < windows.length; i++) {
    const last = groups[groups.length - 1]
    if (last && windows[i]!.label === last.label) last.to = i
    else groups.push({ label: windows[i]!.label, from: i, to: i })
  }
  const spans: Span[] = []
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g]!
    if (grp.label === 'idle') continue
    const prev = groups[g - 1]
    const next = groups[g + 1]
    const startMs = prev
      ? (windows[prev.to]!.centerMs + windows[grp.from]!.centerMs) / 2
      : t0
    const endMs = next ? (windows[grp.to]!.centerMs + windows[next.from]!.centerMs) / 2 : t1
    spans.push({ startMs, endMs, hand: run.hand, label: grp.label })
  }
  return spans
}

export function detectSegments(frames: LandmarkFrame[]): DetectedSegment[] {
  const runs = buildRuns(frames)
  const allWindows = new Map<Span, Window[]>()
  let spans: Span[] = []
  for (const run of runs) {
    const windows = classifyRun(run)
    for (const s of runSpans(run, windows)) {
      spans.push(s)
      allWindows.set(s, windows)
    }
  }
  spans = spans.sort((a, b) => a.startMs - b.startMs)

  // Merge same-hand same-movement spans separated by short pauses/dropouts —
  // the pause shows up as hesitation/quality metrics, not as two results.
  const merged: Span[] = []
  const mergedWindows: Window[][] = []
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.hand === s.hand &&
      prev.label === s.label &&
      s.startMs - prev.endMs <= SEG_MERGE_GAP_MS
    ) {
      prev.endMs = Math.max(prev.endMs, s.endMs)
      mergedWindows[mergedWindows.length - 1]!.push(...(allWindows.get(s) ?? []))
    } else {
      merged.push({ ...s })
      mergedWindows.push([...(allWindows.get(s) ?? [])])
    }
  }

  const detected = frames.filter((f) => f.landmarks !== null && f.handedness !== null)
  const out: DetectedSegment[] = []
  merged.forEach((s, i) => {
    // Snap boundaries to actual detected-frame timestamps of the right hand.
    const inside = detected.filter(
      (f) => f.t >= s.startMs && f.t <= s.endMs && f.handedness === s.hand,
    )
    if (inside.length === 0) return
    const startMs = inside[0]!.t
    const endMs = inside[inside.length - 1]!.t
    if (endMs - startMs < SEG_MIN_SEGMENT_MS) return

    const within = detected.filter((f) => f.t >= startMs && f.t <= endMs)
    const handPurity = within.length > 0 ? inside.length / within.length : 0
    const windows = mergedWindows[i]!.filter((w) => w.centerMs >= startMs && w.centerMs <= endMs)
    const agreeing = windows.filter((w) => w.label === s.label).length
    const labelShare = windows.length > 0 ? agreeing / windows.length : 0

    out.push({
      startMs,
      endMs,
      hand: s.hand,
      testId: s.label === 'tap' ? 'finger_tap' : 'fist_open_close',
      confidence: Math.min(handPurity, labelShare),
    })
  })
  return out.sort((a, b) => a.startMs - b.startMs)
}

/** Cut the frames of one segment for analysis/storage. Frames of the OTHER
 *  hand become blank frames rather than being dropped: the time base stays
 *  intact (events align with the video timeline), detectionRate means
 *  "target hand visible", and >MAX_GAP_MS holes still split analysis
 *  segments inside analyzeCycleTest. */
export function sliceFrames(
  frames: LandmarkFrame[],
  seg: { startMs: number; endMs: number; hand: Hand },
): LandmarkFrame[] {
  return frames
    .filter((f) => f.t >= seg.startMs && f.t <= seg.endMs)
    .map((f) =>
      f.handedness === seg.hand
        ? f
        : { ...f, landmarks: null, world: null, handedness: null, score: 0 },
    )
}

/** Flip every frame's handedness label (mirrored phone recordings). */
export function swapFramesHandedness(frames: LandmarkFrame[]): LandmarkFrame[] {
  return frames.map((f) =>
    f.handedness === null
      ? f
      : { ...f, handedness: f.handedness === 'left' ? ('right' as Hand) : ('left' as Hand) },
  )
}
