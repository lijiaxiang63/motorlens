# MotorLens

Camera-based hand motor function assessment, available as a browser app or a
native desktop app (macOS/Windows). MotorLens uses your camera and
[MediaPipe hand tracking](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
(21 landmarks per hand) to run structured, timed motor tests and compute
standardized kinematic parameters — finger-tapping speed, fist open–close
speed, amplitude decrement, rhythm variability, and per-joint flexion angles.

> **Medical disclaimer** — MotorLens is an assessment aid for tracking and
> quantifying movement, inspired by clinical motor exams (e.g. MDS-UPDRS
> items 3.4/3.5). It is **not a diagnostic device** and its outputs are not
> medical advice.
>
> **Privacy** — all processing runs on-device. No video, landmarks, or
> results ever leave your computer.

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

Beyond ad-hoc quick tests, the **Subjects** workflow registers a subject, runs
the full test battery per hand, and auto-saves every result (optionally with
the source video) to on-device storage; **Video Analysis** uploads an existing
recording, auto-segments it into individual taps/fists for review and
correction, and analyzes each confirmed segment with the same pipeline.
"Export all (ZIP)" bundles every subject's results, videos, and a
`summary.csv` into one download.

## Desktop app

Download the latest macOS or Windows build from
[Releases](https://github.com/lijiaxiang63/motorlens/releases). The desktop
app is the same code as the browser build, wrapped in Electron for native
window chrome, a Dock/taskbar icon, and native save/open dialogs — camera
processing and storage stay entirely on-device either way.

**Installing an unsigned build** — the app isn't code-signed yet (no Apple
Developer ID / no EV certificate), so the OS will warn on first launch:

- **macOS**: Gatekeeper blocks the unidentified developer. Right-click the
  app → *Open* → *Open* (only needed once), or clear the quarantine flag from
  Terminal: `xattr -dr com.apple.quarantine /Applications/MotorLens.app`.
- **Windows**: SmartScreen shows "Windows protected your PC". Click
  *More info* → *Run anyway*.

**Auto-update** differs by platform until the app is signed:

- **Windows** downloads and installs updates in-app (Settings → *Check for
  updates*).
- **macOS** checks GitHub for a newer release and, if found, links out to the
  release page to download manually — Apple's installer (Squirrel.Mac)
  refuses to install unsigned updates in-app, so this is the closest
  unsigned macOS can get to auto-update.

Both platforms check once on launch (silently, unless an update is found) and
on demand from Settings.

### Release process (maintainers)

```bash
npm version <patch|minor|major>   # bumps package.json, the single source for
                                   # APP_VERSION (embedded in every exported
                                   # report) and the packaged app's version
git push && git push --tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`: tests run once,
then macOS and Windows builds run in parallel and each uploads its packaged
output (dmg, zip, exe installer, block maps, and the `latest*.yml` update
feeds electron-updater reads) as a workflow artifact. A final `publish` job
downloads both, generates a brief changelog from the commit log since the
previous tag, and creates a single **published** (non-draft) GitHub Release
with everything attached — that's immediate: existing installs start seeing
the update as soon as the tag is pushed, so make sure the tag is ready before
pushing it.

## Setup

Requires Node ≥ 20 and a Chromium-based browser or Safari.

```bash
npm install        # also copies the MediaPipe wasm runtime and downloads the
                   # hand landmarker model (~7.5 MB) into public/mediapipe/
npm run dev        # http://localhost:5173
npm run dev:app    # same app, running inside Electron (macOS-only camera
                   # verification so far — see the caveat below)
npm run build:app  # produces a local, unsigned .dmg/.zip in release/
                   # (macOS host required — uses iconutil)
```

### LAN access (other devices on your network)

```bash
npm run dev:lan    # generates a self-signed cert on first run, then serves
                   # https://<your-ip>:5173 on all interfaces
```

Open the `Network:` URL Vite prints (e.g. `https://10.10.1.6:5173`) from the
other device and accept the one-time certificate warning — HTTPS is required
because browsers only allow camera access on secure origins (plain
`http://<ip>` would load, but with the camera disabled). macOS may ask to
allow `node` to accept incoming connections the first time; click Allow.

Camera access requires `localhost` or HTTPS. If the model download fails
(offline install), the app falls back to CDN URLs at runtime; to be fully
offline, download it manually:

```bash
curl -L -o public/mediapipe/hand_landmarker.task \
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
```

## Metric definitions

Movement signals are measured on MediaPipe's metric 3-D **world landmarks**,
so neither camera distance nor hand rotation (palm tilt during taps/clenches)
distorts them. All distances are **scale-normalized**: divided by the hand
scale `S` = wrist→middle-MCP distance (landmarks 0→9). One "hand unit" ≈ one
palm length; `S` in cm gives the secondary `≈ cm` values (typical adult
≈ 8 cm).

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
   [src/config.ts](src/config.ts) (platform-dependent, at most once; the
   current default of `false` was verified on macOS Chrome with the
   built-in camera).
3. Finger tap test: tap exactly 10 slow taps → count should be 10.
4. Tap steadily while moving your hand closer/farther → amplitude stays
   roughly constant (scale normalization).
5. Tap with deliberately shrinking amplitude → clear positive decrement;
   pause ~1 s mid-test → hesitation count ≥ 1.
6. Fist test: 8 full open–close cycles → count 8.
7. Joint Monitor: straight fingers read < ~15°, a full fist puts PIP joints
   around 90–110°, ROM accumulates, Reset works.
8. Export JSON from a result, drag it back onto home → identical metrics.

> **Platform caveat** — the checklist above (and `SWAP_RAW_HANDEDNESS` in
> `src/config.ts`) has only been verified on macOS with a built-in camera.
> The Windows desktop build has not had a real-camera check yet; if
> handedness reads flipped on Windows, that flag may need a platform-specific
> value.

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
