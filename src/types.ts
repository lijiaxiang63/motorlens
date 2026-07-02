// Core data types shared across the app. Everything downstream of a
// FrameSource sees only LandmarkFrame — camera, synthetic, and replayed
// sessions are indistinguishable.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type Hand = 'left' | 'right'

export type TestId = 'finger_tap' | 'fist_open_close' | 'joint_monitor'

export interface LandmarkFrame {
  /** Milliseconds, monotonic within a session (video mediaTime based). */
  t: number
  /** 21 normalized image-space landmarks, or null when no hand detected. */
  landmarks: Vec3[] | null
  /** 21 world landmarks in meters (origin ≈ hand center), or null. */
  world: Vec3[] | null
  /** Physical hand, already mirror-corrected. Null when undetected. */
  handedness: Hand | null
  /** Hand presence confidence 0..1 (0 when undetected). */
  score: number
  /** videoWidth / videoHeight of the source frame. */
  aspect: number
}

/** Parallel time/value arrays (uPlot-friendly). t in ms. */
export interface Series {
  t: number[]
  v: number[]
}

export interface SourceStatus {
  state: 'init' | 'ready' | 'error'
  message?: string
}

export interface FrameSource {
  readonly kind: 'camera' | 'synthetic' | 'replay'
  /** Live video element for preview, null for synthetic/replay sources. */
  readonly video: HTMLVideoElement | null
  start(): Promise<void>
  stop(): void
  /** Restart playback from the beginning (no-op for camera sources). */
  restart(): void
  subscribe(cb: (f: LandmarkFrame) => void): () => void
  onStatus(cb: (s: SourceStatus) => void): () => void
}

// ---------------------------------------------------------------------------
// Metrics

/** One movement cycle: closure (signal valley) with its surrounding peaks. */
export interface CycleEvent {
  /** Time of closure (valley), ms. */
  tMs: number
  /** Preceding peak value minus valley value, hand units. */
  closingAmplitude: number
  /** Following peak minus valley, or null for the last event. */
  openingAmplitude: number | null
  /** Max closing speed between preceding peak and valley, hand units/s. */
  peakClosingVel: number
  /** Max opening speed between valley and following peak, or null. */
  peakOpeningVel: number | null
  /** Index of the segment this event belongs to (tracking-gap splits). */
  segment: number
}

export interface DecrementResult {
  /** OLS-regression decrement across the test, % (positive = decline). */
  regressionPct: number | null
  /** First-third vs last-third decrement, % (needs ≥6 events). */
  thirdsPct: number | null
}

export interface RhythmMetrics {
  itiMeanMs: number | null
  /** Coefficient of variation of inter-event intervals, % (needs ≥3 ITIs). */
  itiCvPct: number | null
  hesitationCount: number
  longestPauseMs: number | null
  /** Event-to-event intervals discarded because they span a tracking gap. */
  droppedIntervals: number
}

export interface QualityMetrics {
  meanFps: number
  /** Fraction of frames with a detected hand, 0..1. */
  detectionRate: number
  droppedIntervals: number
  /** CV of the projected hand size, % — positioning-stability indicator
   *  (distance changes and palm tilt both raise it; amplitudes are computed
   *  from rotation-invariant world landmarks and are unaffected). */
  handScaleCvPct: number
}

/** Shared metric shape for both timed cycle tests (tap and fist). */
export interface CycleTestMetrics {
  count: number
  frequencyHz: number | null
  amplitudeMean: number | null
  amplitudeMax: number | null
  amplitudeMeanCm: number | null
  /** Mean/max over per-event peak closing velocity, hand units/s. */
  closingVelMean: number | null
  closingVelPeak: number | null
  closingVelPeakCmS: number | null
  openingVelMean: number | null
  openingVelPeak: number | null
  amplitudeDecrement: DecrementResult
  velocityDecrement: DecrementResult
  rhythm: RhythmMetrics
  /** Centimeters per hand unit (from world landmarks), null if unavailable. */
  cmPerUnit: number | null
}

/** Full analysis bundle for a recorded cycle test (metrics + chart data). */
export interface CycleAnalysis {
  metrics: CycleTestMetrics
  /** Smoothed detection signal (concatenated segments), hand units. */
  signal: Series
  events: CycleEvent[]
  quality: QualityMetrics
}

// ---------------------------------------------------------------------------
// Joints

export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'

export type JointId =
  | 'thumb_cmc'
  | 'thumb_mcp'
  | 'thumb_ip'
  | `${'index' | 'middle' | 'ring' | 'pinky'}_${'mcp' | 'pip' | 'dip'}`

export interface JointSummary {
  currentDeg: number | null
  minDeg: number | null
  maxDeg: number | null
  romDeg: number | null
  peakAngVelDegS: number | null
}

export type JointSummaries = Record<JointId, JointSummary>

// ---------------------------------------------------------------------------
// Session report (export JSON)

/** Subject metadata embedded in exported reports. Optional and additive —
 *  parseSessionJson ignores unknown fields, so schemaVersion stays 1 and
 *  pre-subject reports round-trip unchanged. */
export interface ReportSubject {
  code: string
  name?: string
  sex?: 'male' | 'female' | 'other'
  birthYear?: number
  dominantHand?: Hand
  diagnosis?: string
  notes?: string
}

/** How the frames were acquired. Absent = live camera (pre-feature reports). */
export interface ReportSource {
  kind: 'live' | 'video'
  /** Original name of the uploaded file (video only). */
  fileName?: string
  /** Segment bounds within the uploaded file, ms of video time (video only). */
  segmentStartMs?: number
  segmentEndMs?: number
}

export interface SessionReport {
  schemaVersion: 1
  app: { name: 'MotorLens'; version: string }
  test: TestId
  hand: Hand
  /** ISO timestamp of recording start. */
  startedAt: string
  durationMs: number
  quality: QualityMetrics | null
  metrics: CycleTestMetrics | JointSummaries
  series: Series
  events: CycleEvent[]
  raw: { frames: LandmarkFrame[] }
  subject?: ReportSubject
  source?: ReportSource
}
