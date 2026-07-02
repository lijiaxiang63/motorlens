// Rhythm regularity from inter-event intervals. Intervals that span a
// tracking gap are not patient behavior — they are excluded and counted
// separately as droppedIntervals.

import { cvPct, mean, median } from '../signal/stats'
import type { CycleEvent, RhythmMetrics } from '../types'

export function computeRhythm(events: CycleEvent[], hesitationAbsMs: number): RhythmMetrics {
  const itis: number[] = []
  let dropped = 0
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1]!
    const b = events[i]!
    if (a.segment === b.segment) itis.push(b.tMs - a.tMs)
    else dropped++
  }
  if (itis.length === 0) {
    return {
      itiMeanMs: null,
      itiCvPct: null,
      hesitationCount: 0,
      longestPauseMs: null,
      droppedIntervals: dropped,
    }
  }
  const threshold = Math.max(2 * median(itis), hesitationAbsMs)
  const cv = itis.length >= 3 ? cvPct(itis) : NaN
  return {
    itiMeanMs: mean(itis),
    itiCvPct: Number.isFinite(cv) ? cv : null,
    hesitationCount: itis.filter((x) => x > threshold).length,
    longestPauseMs: Math.max(...itis),
    droppedIntervals: dropped,
  }
}
