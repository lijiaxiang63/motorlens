// Every tunable in one place.

// --- Test protocol ---
export const TAP_TEST_MS = 10_000
export const FIST_TEST_MS = 10_000
export const COUNTDOWN_MS = 3_000

// Positioning gates (evaluated over a trailing window of frames)
export const GATE_WINDOW_FRAMES = 30
export const GATE_PRESENCE_MIN = 0.9
export const GATE_HANDEDNESS_MIN = 0.8
export const GATE_MIN_FPS = 15
/** Acceptable hand scale |P0−P9| range in height units (too far / too close). */
export const HAND_SCALE_RANGE: readonly [number, number] = [0.06, 0.5]
/** Hand lost for longer than this during countdown → back to positioning. */
export const COUNTDOWN_HAND_LOST_MS = 500

// --- Signal analysis ---
/** Gaps in detection longer than this split the recording into segments. */
export const MAX_GAP_MS = 300
// 8 Hz: high enough that a fast 4 Hz tap loses <20% amplitude to the
// zero-phase double-EMA, low enough to suppress landmark jitter.
export const TAP_FC_HZ = 8
export const FIST_FC_HZ = 5
export const ANGLE_FC_HZ = 4
/** Peak-prominence floors (hand units) and adaptive range factor. */
export const TAP_PROM_FLOOR = 0.15
export const FIST_PROM_FLOOR = 0.2
export const PROM_RANGE_FACTOR = 0.25
/** Minimum spacing between detected events (physiological limits). */
export const TAP_MIN_DIST_MS = 125
export const FIST_MIN_DIST_MS = 200
/** Absolute hesitation floors: ITI > max(2·median, this) counts as one. */
export const TAP_HESITATION_ABS_MS = 400
export const FIST_HESITATION_ABS_MS = 700
/** Trailing median window (in detected frames) for the hand-scale signal. */
export const HAND_SCALE_MEDIAN_WINDOW = 15
/** Warn when hand-scale CV exceeds this (camera distance changed), %. */
export const HAND_SCALE_CV_WARN_PCT = 15

// --- Hand tracking ---
/**
 * tasks-vision reports handedness assuming a mirrored (selfie) image, but
 * getUserMedia frames are unmirrored, so the label is swapped relative to
 * the user's physical hand. Verified via the manual checklist in README;
 * flip this once if your platform reports the opposite.
 */
export const SWAP_RAW_HANDEDNESS = true

export const MEDIAPIPE_VERSION = '0.10.35'
export const LOCAL_WASM_BASE = '/mediapipe/wasm'
export const LOCAL_MODEL_URL = '/mediapipe/hand_landmarker.task'
export const CDN_WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
export const CDN_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

// --- UI ---
export const LIVE_CHART_WINDOW_MS = 6_000
export const LIVE_COUNT_THROTTLE_MS = 250
export const TAP_LIVE_Y_RANGE: readonly [number, number] = [0, 1.8]
export const FIST_LIVE_Y_RANGE: readonly [number, number] = [0, 2.6]

export const APP_VERSION = '0.1.0'
