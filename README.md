# ◎ MotorLens

Camera-based hand motor function assessment in the browser. MotorLens uses
your laptop camera and [MediaPipe hand tracking](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
(21 landmarks per hand) to run structured, timed motor tests and compute
standardized kinematic parameters — finger-tapping speed, fist open–close
speed, amplitude decrement, rhythm variability, and per-joint flexion angles.

> **Medical disclaimer** — MotorLens is an assessment aid for tracking and
> quantifying movement, inspired by clinical motor exams (e.g. MDS-UPDRS
> items 3.4/3.5). It is **not a diagnostic device** and its outputs are not
> medical advice.
>
> **Privacy** — all processing runs on-device in your browser. No video,
> landmarks, or results ever leave your computer.

## Assessments

| Test | What you do | What it measures |
|---|---|---|
| **Finger Tapping** (10 s/hand) | Tap index fingertip against thumb tip, as big and fast as possible | Tap count, frequency, amplitude, opening/closing speed, amplitude & velocity decrement, rhythm CV, hesitations |
| **Fist Open–Close** (10 s/hand) | Open the hand fully, clench into a fist, repeat | Cycle count, frequency, aperture amplitude, clench/open speed, decrement, rhythm |
| **Joint Monitor** (live) | Move freely | Flexion angle, min/max, range of motion, and peak angular velocity for all 15 finger joints |

Each timed test runs: positioning check (hand visible, correct hand, good
distance) → 3 s countdown → 10 s recording with live signal chart and event
count → results with metric cards, three charts, and JSON export. Exported
sessions can be dragged back onto the home screen to reproduce their results
exactly.

## Setup

Requires Node ≥ 20 and a Chromium-based browser or Safari.

```bash
npm install        # also copies the MediaPipe wasm runtime and downloads the
                   # hand landmarker model (~7.5 MB) into public/mediapipe/
npm run dev        # http://localhost:5173
```

Camera access requires `localhost` or HTTPS. If the model download fails
(offline install), the app falls back to CDN URLs at runtime; to be fully
offline, download it manually:

```bash
curl -L -o public/mediapipe/hand_landmarker.task \
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
```

## Metric definitions

All distances are **scale-normalized**: divided by the hand scale `S` =
wrist→middle-MCP distance (landmarks 0→9) measured per frame, so values are
independent of how far the hand is from the camera. One "hand unit" ≈ one
palm length; the world-landmark estimate of `S` in cm gives the secondary
`≈ cm` values (typical adult ≈ 8 cm).

| Metric | Definition |
|---|---|
| Signal (tap) | Thumb-tip↔index-tip distance / S |
| Signal (fist) | Mean fingertip→wrist distance of 4 fingers / S |
| Event (tap/cycle) | A signal **valley** (closure) preceded by a peak, after zero-phase smoothing and prominence-filtered peak detection |
| Frequency | (N−1) / time between first and last event |
| Amplitude | Preceding peak minus valley, per event (smoothing attenuates absolute amplitude by ~5–15%; comparisons within/between MotorLens tests are unaffected) |
| Closing/opening speed | Peak signal slope between peak↔valley, hand units/s |
| Decrement | Linear-regression decline across events as % of starting value (positive = fatiguing); a first-third vs last-third comparison is reported alongside |
| Rhythm variability | Coefficient of variation of inter-event intervals |
| Hesitation | Interval > max(2 × median interval, 0.4 s tap / 0.7 s fist) |
| Joint flexion | 180° − interior angle at the joint from 3-D world landmarks (0° = straight) |

Recording quality (fps, % frames with a detected hand, camera-distance
variation) is reported with every result, with warnings when it may
compromise the numbers. Tracking dropouts split the recording into segments;
intervals spanning a dropout are excluded from rhythm metrics.

## Synthetic mode (no camera needed)

Every metric is computable from synthetic, ground-truth-known landmark
streams — used by the unit tests and handy for demos:

```
http://localhost:5173/?source=synthetic&preset=tap-2hz&speed=4
```

Presets: `tap-2hz`, `tap-decrement`, `tap-hesitant`, `tap-slow`,
`fist-1p5hz`, `angles-sweep`. `speed` accelerates playback without changing
the measured values. Dropping an exported session JSON onto the home screen
re-analyzes its raw frames and reproduces the original results.

## Testing

```bash
npm test           # vitest: signal processing + metrics vs synthetic ground truth
npm run typecheck
npm run build
```

### Manual camera checklist

1. Open http://localhost:5173 in Chrome, grant camera access → the skeleton
   overlay should track your hand and mirror naturally.
2. Raise your **right** hand → the status chip must read "right hand
   detected". If it says left, flip `SWAP_RAW_HANDEDNESS` in
   [src/config.ts](src/config.ts) (platform-dependent, at most once).
3. Finger tap test: tap exactly 10 slow taps → count should be 10.
4. Tap steadily while moving your hand closer/farther → amplitude stays
   roughly constant (scale normalization).
5. Tap with deliberately shrinking amplitude → clear positive decrement;
   pause ~1 s mid-test → hesitation count ≥ 1.
6. Fist test: 8 full open–close cycles → count 8.
7. Joint Monitor: straight fingers read < ~15°, a full fist puts PIP joints
   around 90–110°, ROM accumulates, Reset works.
8. Export JSON from a result, drag it back onto home → identical metrics.

## Architecture notes

- `src/signal/` and `src/metrics/` are pure functions (no DOM) — the whole
  analysis pipeline is unit-tested against `src/replay/synthetic.ts`, which
  generates landmark streams with exact known counts/amplitudes/timing.
- Every frame source (camera, synthetic, replayed JSON) implements the same
  `FrameSource` interface emitting `LandmarkFrame`s, so everything
  downstream is camera-independent.
- The test flow (`src/protocol/testSession.ts`) is driven purely by frame
  timestamps — it behaves identically at any playback speed and is unit
  tested with synthetic frames.
- GPU delegate with automatic CPU retry; local MediaPipe assets with CDN
  fallback; recordings never abort on tracking loss (gaps are segmented and
  reported as quality metrics).
