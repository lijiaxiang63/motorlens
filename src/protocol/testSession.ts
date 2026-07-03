// Assessment flow state machine, driven purely by onFrame() so it can be
// tested with synthetic frames and works identically at any playback speed
// (all timing uses frame timestamps, not wall clock).

import {
  COUNTDOWN_HAND_LOST_MS,
  COUNTDOWN_MS,
  GATE_HANDEDNESS_MIN,
  GATE_MIN_FPS,
  GATE_PRESENCE_MIN,
  GATE_WINDOW_FRAMES,
  HAND_SCALE_RANGE,
} from '../config'
import { gateHandScale } from '../metrics/kinematics'
import { mean } from '../signal/stats'
import type { Hand, LandmarkFrame } from '../types'

export type PositioningIssue =
  | 'warming_up'
  | 'no_hand'
  | 'wrong_hand'
  | 'too_far'
  | 'too_close'
  | 'low_fps'

export type Phase =
  | { kind: 'positioning'; issues: PositioningIssue[] }
  | { kind: 'countdown'; remainingMs: number }
  | { kind: 'recording'; elapsedMs: number; frames: LandmarkFrame[] }
  | { kind: 'done'; frames: LandmarkFrame[] }
  | { kind: 'cancelled' }

export class TestSession {
  private phase: Phase = { kind: 'positioning', issues: ['warming_up'] }
  private window: LandmarkFrame[] = []
  private buffer: LandmarkFrame[] = []
  private countdownStart = 0
  private lastHandSeenT = 0
  private recStart = 0
  private subs = new Set<(p: Phase) => void>()

  constructor(
    private durationMs: number,
    private hand: Hand,
    /** Per-test framing-gate range (TestDefinition.handScaleRange). */
    private handScaleRange: readonly [number, number] = HAND_SCALE_RANGE,
  ) {}

  get current(): Phase {
    return this.phase
  }

  subscribe(cb: (p: Phase) => void): () => void {
    this.subs.add(cb)
    cb(this.phase)
    return () => this.subs.delete(cb)
  }

  cancel(): void {
    if (this.phase.kind === 'done') return
    this.setPhase({ kind: 'cancelled' })
  }

  onFrame(f: LandmarkFrame): void {
    switch (this.phase.kind) {
      case 'positioning': {
        this.window.push(f)
        if (this.window.length > GATE_WINDOW_FRAMES) this.window.shift()
        const issues = this.evaluateGates()
        if (issues.length === 0) {
          this.countdownStart = f.t
          this.lastHandSeenT = f.t
          this.setPhase({ kind: 'countdown', remainingMs: COUNTDOWN_MS })
        } else {
          this.setPhase({ kind: 'positioning', issues })
        }
        break
      }
      case 'countdown': {
        if (f.landmarks) {
          this.lastHandSeenT = f.t
        } else if (f.t - this.lastHandSeenT > COUNTDOWN_HAND_LOST_MS) {
          this.window = []
          this.setPhase({ kind: 'positioning', issues: ['no_hand'] })
          break
        }
        const remaining = COUNTDOWN_MS - (f.t - this.countdownStart)
        if (remaining <= 0) {
          this.recStart = f.t
          this.buffer = [f]
          this.setPhase({ kind: 'recording', elapsedMs: 0, frames: this.buffer })
        } else {
          this.setPhase({ kind: 'countdown', remainingMs: remaining })
        }
        break
      }
      case 'recording': {
        this.buffer.push(f)
        const elapsed = f.t - this.recStart
        if (elapsed >= this.durationMs) {
          this.setPhase({ kind: 'done', frames: this.buffer })
        } else {
          this.setPhase({ kind: 'recording', elapsedMs: elapsed, frames: this.buffer })
        }
        break
      }
      case 'done':
      case 'cancelled':
        break
    }
  }

  /** Empty result = all gates pass. Tracking loss never aborts a recording —
   *  gates only guard the entry into the countdown. */
  private evaluateGates(): PositioningIssue[] {
    const w = this.window
    if (w.length < GATE_WINDOW_FRAMES) return ['warming_up']
    const issues: PositioningIssue[] = []
    const detected = w.filter((f) => f.landmarks)
    if (detected.length / w.length < GATE_PRESENCE_MIN) {
      issues.push('no_hand')
    } else {
      const matching = detected.filter((f) => f.handedness === this.hand)
      if (matching.length / detected.length < GATE_HANDEDNESS_MIN) issues.push('wrong_hand')
      const scale = mean(detected.map((f) => gateHandScale(f.landmarks!, f.aspect)))
      if (scale < this.handScaleRange[0]) issues.push('too_far')
      if (scale > this.handScaleRange[1]) issues.push('too_close')
    }
    const span = w[w.length - 1]!.t - w[0]!.t
    if (span <= 0 || ((w.length - 1) / span) * 1000 < GATE_MIN_FPS) issues.push('low_fps')
    return issues
  }

  private setPhase(p: Phase): void {
    this.phase = p
    for (const cb of this.subs) cb(p)
  }
}
