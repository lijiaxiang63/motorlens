// Named synthetic scenarios, selectable via ?source=synthetic&preset=<name>.
// All run 16 s so a full positioning + countdown + 10 s recording fits
// before the pattern loops (the record screen restarts playback on entry).

import type { LandmarkFrame } from '../types'
import { makeAngleFrames, makeFistFrames, makeTapFrames } from './synthetic'

export interface Preset {
  name: string
  description: string
  frames: LandmarkFrame[]
}

const DURATION = 16_000

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
  'angles-sweep',
] as const

export function getPreset(name: string): Preset {
  return build(name) ?? build('tap-2hz')!
}
