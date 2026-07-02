// Shared cycle engine for both timed tests. A movement cycle is a closure
// (signal valley) preceded by an opening peak — matching how a clinician
// counts taps or fist clenches.

import { findPeaks, findValleys, type Peak, type PeakOptions } from '../signal/peaks'
import type { CycleEvent } from '../types'

interface Extremum {
  kind: 'peak' | 'valley'
  p: Peak
}

export function extractCycles(
  t: number[],
  s: number[],
  vel: number[],
  opts: PeakOptions,
  segment: number,
): CycleEvent[] {
  const merged: Extremum[] = [
    ...findPeaks(t, s, opts).map((p) => ({ kind: 'peak' as const, p })),
    ...findValleys(t, s, opts).map((p) => ({ kind: 'valley' as const, p })),
  ].sort((a, b) => a.p.i - b.p.i)

  // Enforce strict peak/valley alternation: between two peaks with no valley
  // in between keep the higher, between two valleys keep the lower.
  const seq: Extremum[] = []
  for (const e of merged) {
    const last = seq[seq.length - 1]
    if (!last || last.kind !== e.kind) {
      seq.push(e)
    } else if (e.kind === 'peak' ? e.p.v > last.p.v : e.p.v < last.p.v) {
      seq[seq.length - 1] = e
    }
  }

  const events: CycleEvent[] = []
  for (let k = 1; k < seq.length; k++) {
    const cur = seq[k]!
    if (cur.kind !== 'valley') continue
    const prev = seq[k - 1]! // guaranteed a peak by alternation
    const next = seq[k + 1] // following peak, if any
    let peakClosingVel = 0
    for (let i = prev.p.i; i <= cur.p.i; i++) {
      peakClosingVel = Math.max(peakClosingVel, -vel[i]!)
    }
    let peakOpeningVel: number | null = null
    if (next) {
      peakOpeningVel = 0
      for (let i = cur.p.i; i <= next.p.i; i++) {
        peakOpeningVel = Math.max(peakOpeningVel, vel[i]!)
      }
    }
    events.push({
      tMs: cur.p.t,
      closingAmplitude: prev.p.v - cur.p.v,
      openingAmplitude: next ? next.p.v - cur.p.v : null,
      peakClosingVel,
      peakOpeningVel,
      segment,
    })
  }
  return events
}
