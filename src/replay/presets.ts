// Named synthetic scenarios, selectable via ?source=synthetic&preset=<name>.
// Each preset sizes its own loop so a full positioning + countdown +
// recording fits before the pattern restarts (the record screen restarts
// playback on entry): 16 s covers the 10 s tests; the 15 s tremor tests
// need 24 s.

import type { LandmarkFrame } from '../types'
import {
  makeAngleFrames,
  makeFistFrames,
  makePronosupFrames,
  makeRomSweepFrames,
  makeTapFrames,
  makeTremorFrames,
} from './synthetic'

export interface Preset {
  name: string
  description: string
  frames: LandmarkFrame[]
}

/** Positioning (~1 s) + countdown (3 s) + 10 s recording < 16 s. */
const DURATION = 16_000
/** Same setup + the 15 s tremor recording needs a longer loop. */
const TREMOR_DURATION = 24_000

function build(name: string): Preset | null {
  switch (name) {
    case 'tap-2hz':
      return {
        name,
        description: 'Steady 2 Hz finger tapping, ~20 taps in a 10 s window',
        frames: makeTapFrames({ durationMs: DURATION, noiseSd: 0.015, seed: 3 }).frames,
      }
    case 'tap-decrement':
      return {
        name,
        // 42% linear decline over the full 16 s ≈ 30% measured in a 10 s
        // window that starts ~4.5 s in (positioning + countdown).
        description: 'Tapping with fatiguing amplitude (~30% decrement)',
        frames: makeTapFrames({ durationMs: DURATION, decrementPct: 42, noiseSd: 0.015, seed: 4 })
          .frames,
      }
    case 'tap-hesitant':
      return {
        name,
        description: 'Irregular tapping with two long hesitations',
        frames: makeTapFrames({
          durationMs: DURATION,
          itiJitterPct: 8,
          hesitations: [
            { atMs: 6_000, extraMs: 1_200 },
            { atMs: 10_500, extraMs: 900 },
          ],
          noiseSd: 0.015,
          seed: 5,
        }).frames,
      }
    case 'tap-slow':
      return {
        name,
        description: 'Slow, small-amplitude tapping (bradykinesia-like)',
        frames: makeTapFrames({
          durationMs: DURATION,
          freqHz: 1.2,
          openDist: 0.65,
          noiseSd: 0.015,
          seed: 6,
        }).frames,
      }
    case 'fist-1p5hz':
      return {
        name,
        description: 'Steady 1.5 Hz fist open-close, ~15 cycles in 10 s',
        frames: makeFistFrames({ durationMs: DURATION, freqHz: 1.5, noiseSd: 0.02, seed: 7 })
          .frames,
      }
    case 'pronosup-1hz':
      return {
        name,
        description: 'Steady 1 Hz pronation-supination, ~10 turns in a 10 s window',
        frames: makePronosupFrames({ durationMs: DURATION, freqHz: 1, noiseSd: 1.5, seed: 8 })
          .frames,
      }
    case 'pronosup-forward':
      return {
        name,
        description:
          'Steady 1 Hz pronation-supination with the arm extended toward the camera (foreshortened hand)',
        frames: makePronosupFrames({
          durationMs: DURATION,
          freqHz: 1,
          posture: 'forward',
          noiseSd: 1.5,
          seed: 10,
        }).frames,
      }
    case 'tremor-forward':
      return {
        name,
        description:
          'Steady 5 Hz postural tremor with the arm extended toward the camera (foreshortened hand)',
        frames: makeTremorFrames({
          durationMs: TREMOR_DURATION,
          freqHz: 5,
          ampCm: 0.8,
          posture: 'forward',
          noiseSdCm: 0.02,
          seed: 11,
        }).frames,
      }
    case 'tremor-5hz':
      return {
        name,
        description: 'Steady 5 Hz postural tremor, 0.8 cm peak displacement',
        frames: makeTremorFrames({
          durationMs: TREMOR_DURATION,
          freqHz: 5,
          ampCm: 0.8,
          noiseSdCm: 0.02,
          seed: 9,
        }).frames,
      }
    case 'tremor-rest-5hz':
      return {
        name,
        description:
          '5 Hz pill-rolling rest tremor: thumb–index oscillation with the palm centroid only drifting',
        frames: makeTremorFrames({
          durationMs: TREMOR_DURATION,
          ampCm: 0,
          finger: { freqHz: 5, ampCm: 0.5 },
          drift: { freqHz: 0.6, ampCm: 0.3 },
          noiseSdCm: 0.02,
          seed: 12,
        }).frames,
      }
    case 'rom-sweep-timed':
      return {
        name,
        description: 'Timed ROM: full-hand open-close sweeps (total ≈ 890°)',
        frames: makeRomSweepFrames({ durationMs: DURATION }).frames,
      }
    case 'angles-sweep':
      return {
        name,
        description: 'All fingers flex and extend on a 4 s cycle',
        frames: makeAngleFrames(
          (tMs) => {
            const phase = (1 - Math.cos((2 * Math.PI * tMs) / 4_000)) / 2
            return {
              index_mcp: 50 * phase,
              index_pip: 95 * phase,
              index_dip: 60 * phase,
              middle_mcp: 50 * phase,
              middle_pip: 95 * phase,
              middle_dip: 60 * phase,
              ring_mcp: 45 * phase,
              ring_pip: 90 * phase,
              ring_dip: 55 * phase,
              pinky_mcp: 45 * phase,
              pinky_pip: 85 * phase,
              pinky_dip: 55 * phase,
              thumb_cmc: 20 * phase,
              thumb_mcp: 35 * phase,
              thumb_ip: 50 * phase,
            }
          },
          { durationMs: DURATION },
        ).frames,
      }
    default:
      return null
  }
}

export const PRESET_NAMES = [
  'tap-2hz',
  'tap-decrement',
  'tap-hesitant',
  'tap-slow',
  'fist-1p5hz',
  'pronosup-1hz',
  'pronosup-forward',
  'rom-sweep-timed',
  'tremor-5hz',
  'tremor-forward',
  'tremor-rest-5hz',
  'angles-sweep',
] as const

export function getPreset(name: string): Preset {
  return build(name) ?? build('tap-2hz')!
}
