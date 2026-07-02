import { describe, expect, it } from 'vitest'
import { metricByKey } from './metricCatalog'
import {
  DEFAULT_REFERENCE_THRESHOLDS,
  evaluateThreshold,
  formatThresholdCue,
} from './thresholds'

describe('thresholds', () => {
  it('flags warnBelow with strict <', () => {
    expect(evaluateThreshold({ warnBelow: 3 }, 2.9)).toBe('below')
    expect(evaluateThreshold({ warnBelow: 3 }, 3)).toBeNull() // boundary not flagged
    expect(evaluateThreshold({ warnBelow: 3 }, 3.1)).toBeNull()
  })

  it('flags warnAbove with strict >', () => {
    expect(evaluateThreshold({ warnAbove: 20 }, 20.1)).toBe('above')
    expect(evaluateThreshold({ warnAbove: 20 }, 20)).toBeNull() // boundary not flagged
    expect(evaluateThreshold({ warnAbove: 20 }, 19.9)).toBeNull()
  })

  it('checks both bounds when both are set', () => {
    const t = { warnBelow: 1, warnAbove: 5 }
    expect(evaluateThreshold(t, 0.5)).toBe('below')
    expect(evaluateThreshold(t, 5.5)).toBe('above')
    expect(evaluateThreshold(t, 3)).toBeNull()
  })

  it('warnAbove: 0 flags 1 but not 0 (the hesitation-count default)', () => {
    const t = { warnAbove: 0 }
    expect(evaluateThreshold(t, 0)).toBeNull()
    expect(evaluateThreshold(t, 1)).toBe('above')
  })

  it('never flags a null/non-finite value or an unset threshold', () => {
    expect(evaluateThreshold({ warnAbove: 20 }, null)).toBeNull()
    expect(evaluateThreshold({ warnAbove: 20 }, NaN)).toBeNull()
    expect(evaluateThreshold(undefined, 999)).toBeNull()
    expect(evaluateThreshold({}, 999)).toBeNull()
  })

  it('DEFAULT_REFERENCE_THRESHOLDS mirrors the pre-existing hardcoded cues', () => {
    expect(evaluateThreshold(DEFAULT_REFERENCE_THRESHOLDS.ampDecrementPct, 21)).toBe('above')
    expect(evaluateThreshold(DEFAULT_REFERENCE_THRESHOLDS.ampDecrementPct, 20)).toBeNull()
    expect(evaluateThreshold(DEFAULT_REFERENCE_THRESHOLDS.hesitationCount, 1)).toBe('above')
    expect(evaluateThreshold(DEFAULT_REFERENCE_THRESHOLDS.hesitationCount, 0)).toBeNull()
  })

  it('formatThresholdCue renders a short readable band', () => {
    const freq = metricByKey('frequencyHz') // unit ' Hz'
    const decrement = metricByKey('ampDecrementPct') // unit '%'
    expect(formatThresholdCue(decrement, { warnAbove: 20 })).toBe('> 20%')
    expect(formatThresholdCue(freq, { warnBelow: 3 })).toBe('< 3 Hz')
    expect(formatThresholdCue(freq, {})).toBeNull()
  })
})
