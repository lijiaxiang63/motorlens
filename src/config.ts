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
/**
 * Warn when the projected hand-scale CV exceeds this, %. Movement signals
 * come from rotation-invariant world landmarks, so this no longer affects
 * amplitudes — it is a positioning-stability indicator (normal palm tilt
 * during tapping/clenching produces ~5–15%, hence the high threshold).
 */
export const HAND_SCALE_CV_WARN_PCT = 25

// --- Hand tracking ---
/**
 * Whether to swap MediaPipe's Left/Right handedness label to get the user's
 * physical hand. Verified empirically on this machine (Chrome + built-in
 * camera, 2026-07-02): the raw labels already match the physical hand for
 * unmirrored getUserMedia input, so no swap. If your platform reports the
 * opposite (right hand detected as left), flip this.
 */
export const SWAP_RAW_HANDEDNESS = false

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

// --- Subjects & local storage (IndexedDB) ---
export const DB_NAME = 'motorlens'
export const DB_VERSION = 1
/** Default for the "save camera video" toggle in subject sessions. */
export const SAVE_VIDEO_DEFAULT = true

// --- Live video capture (MediaRecorder during subject-mode tests) ---
export const RECORDER_MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4', // Safari
] as const
export const RECORDER_BITS_PER_SECOND = 2_500_000
/** Give MediaRecorder.onstop this long to deliver; then save without video. */
export const RECORDER_STOP_TIMEOUT_MS = 2_000

// --- Uploaded-video processing (offline MediaPipe over a file) ---
export const VIDEO_PROC_FPS = 30
/** A single seek taking longer than this fails the whole file (codec issue). */
export const VIDEO_SEEK_TIMEOUT_MS = 5_000
/** Warn (and require confirmation) before processing files longer than this. */
export const VIDEO_WARN_DURATION_S = 300

// --- Auto-segmentation of uploaded videos (see metrics/segments.ts) ---
/** Handedness majority vote over this many trailing detected frames. */
export const SEG_VOTE_WINDOW = 15
/** Detection gap that splits presence runs (larger than in-test dropouts). */
export const SEG_GAP_SPLIT_MS = 1_000
export const SEG_MIN_SEGMENT_MS = 3_000
export const SEG_CLASSIFY_WINDOW_MS = 2_000
export const SEG_CLASSIFY_HOP_MS = 500
/** Windows with fewer world-landmark samples than this are 'idle'. */
export const SEG_MIN_WINDOW_SAMPLES = 12
/** p90−p10 of normalized middle/ring/pinky→wrist distance ⇒ fist. Checked
 *  before the tap rule: thumb–index separation oscillates during fists too. */
export const SEG_FIST_OSC_MIN = 0.45
/** p90−p10 of normalized thumb–index separation ⇒ tap (when not a fist). */
export const SEG_TAP_OSC_MIN = 0.25
/** Same-label segments closer than this merge (pauses become hesitations). */
export const SEG_MERGE_GAP_MS = 2_500
/** Flag auto-detected segments below this confidence for manual review. */
export const SEG_CONFIDENCE_WARN = 0.7

export const APP_VERSION = '0.1.0'
