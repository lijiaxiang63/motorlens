// Decrement: how much a per-event value (amplitude, velocity) declines over
// the course of the test — the kinematic signature of bradykinesia/fatigue.

import { linearRegression, mean } from '../signal/stats'
import type { DecrementResult } from '../types'

export function computeDecrement(values: number[]): DecrementResult {
  const n = values.length

  let regressionPct: number | null = null
  if (n >= 4) {
    const x = values.map((_, i) => i)
    const { slope, intercept } = linearRegression(x, values)
    if (Number.isFinite(slope) && intercept > 1e-9) {
      regressionPct = ((-slope * (n - 1)) / intercept) * 100
    }
  }

  let thirdsPct: number | null = null
  if (n >= 6) {
    const third = Math.floor(n / 3)
    const first = mean(values.slice(0, third))
    const last = mean(values.slice(n - third))
    if (first > 1e-9) thirdsPct = (1 - last / first) * 100
  }

  return { regressionPct, thirdsPct }
}
