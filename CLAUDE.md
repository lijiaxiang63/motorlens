# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server, http://localhost:5173 (camera works: localhost is a secure origin)
npm run dev:lan      # HTTPS on all interfaces (self-signed cert in .certs/) — camera on other devices needs this
npm test             # vitest run (all suites)
npx vitest run src/metrics/taps.test.ts   # single suite
npm run test:watch
npm run typecheck    # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run build        # typecheck + vite build
npm run assets       # re-fetch MediaPipe wasm + model into public/mediapipe/ (also runs on postinstall)
```

No lint tooling is configured. `public/mediapipe/` and `.certs/` are generated and gitignored.

## Verification without a camera

Everything downstream of a `FrameSource` is testable with synthetic data; use this before asking the user to camera-test:

- Unit tests validate the full metrics pipeline against `src/replay/synthetic.ts`, whose generators return exact ground truth (`{frames, truth}`) — event times, amplitudes, ITIs are scheduled, not sampled.
- Headless browser: `/?source=synthetic&preset=tap-2hz|tap-decrement|tap-hesitant|tap-slow|fist-1p5hz|angles-sweep&speed=4`, click through the flow, then assert on `window.__lastReport` (SessionReport of the last results screen) and `window.__ctx` (the AppContext; `__ctx.source.kind` tells you which source is live). Presets run 16 s so a positioning + countdown + 10 s recording fits before the pattern loops; the record screen calls `source.restart()` on mount.
- Expected preset results: tap-2hz → 20 taps / 2.00 Hz / ~0 decrement; tap-decrement → ~30% (25–35); fist-1p5hz → 15 cycles / 1.50 Hz; tap-hesitant → 2 hesitations; angles-sweep → per-joint ROM equal to the sweep maxima in `src/replay/presets.ts`.
- Camera-only code (`src/camera/`, `src/tracking/cameraSource.ts`) is lazy-imported in `main.ts` and never loads in synthetic mode — it cannot be exercised headlessly; changes there need a real-camera check by the user.

## Architecture

**The `FrameSource` seam.** Camera, synthetic, and replayed-JSON sources all emit identical `LandmarkFrame`s (`src/types.ts`) and implement `FrameSource`. Nothing downstream knows which is which. `handedness` on a frame is already mirror-corrected physical handedness.

**Pure analysis core.** `src/signal/` (filters, stats, scipy-equivalent peak detection) and `src/metrics/` are DOM-free pure functions. The offline pipeline (`metrics/cycleTest.ts`) runs on the full recording: segment split at >300 ms tracking gaps → zero-phase forward-backward EMA (deliberately non-causal: no peak lag/attenuation bias; live charts use causal `LiveEma` for display only) → adaptive-prominence peak/valley detection → shared cycle engine (`metrics/cycles.ts`: an event = valley with preceding peak, after alternation cleanup) → aggregates (decrement via OLS over event index, rhythm from ITIs within segments). The live tap counter re-runs this same offline pipeline on the accumulated buffer every 250 ms — there is intentionally no separate streaming detector, so live and final counts can't diverge.

**Two coordinate systems, two jobs.** Movement signals and normalization use MediaPipe *world* landmarks (metric 3-D): rigid rotation preserves 3-D distances, so palm tilt during taps/clenches cannot fake amplitude changes or decrement. Signals are divided by world hand scale |W0−W9| ("hand units" ≈ palm lengths; ×`cmPerUnit` for cm). Projected image-space distances are used only for framing gates (too far/close) and the positioning-stability quality metric. `taps.test.ts` has a pitch-wobble test enforcing this invariant — don't move signal math back to image space.

**Frame-time-driven protocol.** `protocol/testSession.ts` is a state machine driven solely by `onFrame(f)` and frame timestamps — no wall-clock reads — so it behaves identically at any replay `speed` and is unit-testable. UI screens (`ui/screens/`) render phases; `ui/app.ts` is a manual router where each screen returns `{el, destroy()}` and must clean up subscriptions and uPlot instances in `destroy()`.

**Report round-trip as regression harness.** Results build a `SessionReport` (schemaVersion 1) with raw frames rounded to 4 dp; dropping an exported JSON on the home screen recomputes metrics from `raw.frames` and must reproduce the original numbers.

## Hard-won invariants (each fixed a real-hardware bug — do not "simplify" away)

- **Camera frame timestamps are wall clock** (the rVFC callback's `now`), never `video.mediaTime`: mediaTime stalls for getUserMedia streams on some stacks, and the strictly-increasing fallback degrades to +1 ms/frame — countdown/test timing then crawls ~30× slow.
- **`SWAP_RAW_HANDEDNESS = false`** in `src/config.ts` was verified empirically on the user's camera (the MediaPipe-docs-suggested swap made every right hand read as left). Flip only with a real-camera re-test.
- **The frame chain must survive exceptions**: `frameClock.ts` try/catches the callback, `cameraSource.ts` turns `detectForVideo` failures into no-hand frames, and both sources isolate each subscriber. One throwing consumer previously froze the whole app.
- **`replaySource.ts` does wall-clock catch-up batching**: hidden tabs throttle `setTimeout` to 1 Hz; emitting only one frame per tick stalls playback. It also inserts a >`MAX_GAP_MS` time gap at loop/restart boundaries so analyses segment there.
- **The camera `<video>` element doesn't exist until the camera opens** — `ui/preview.ts` late-attaches it in its rAF loop (and resumes it if a DOM move paused it). Screens created before camera-ready would otherwise show skeleton-only forever.
- **uPlot sizing**: charts mount on an inner 100%-width div and resize only when width actually changes (`ui/liveChart.ts`) — observing the padded panel directly causes a ResizeObserver↔setSize feedback loop inside grid tracks (`min-width: 0` on grid children matters too).
- Recording never aborts on tracking loss; gaps become segments and quality metrics (`droppedIntervals`, detection rate). Positioning gates only guard entry into the countdown.

All tunables (test durations, smoothing cutoffs, peak thresholds, gate limits, asset URLs) live in `src/config.ts`. When adding a metric or test type, extend `TestDefinition` in `protocol/definitions.ts` and add a ground-truth generator + suite mirroring `metrics/taps.test.ts`.

For preview tooling in this environment, the launch config lives at `/Users/jiaxiangli/dev/.claude/launch.json` (dev-root, uses `npm --prefix`), not only in this repo. The user runs the app over LAN via `npm run dev:lan`.
