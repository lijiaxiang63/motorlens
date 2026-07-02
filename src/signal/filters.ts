// Sample-rate-aware smoothing. Metrics run offline on the full recording,
// so we can afford zero-phase (forward-backward) filtering: peak timing and
// amplitude are not biased by filter lag, unlike any causal filter.

/** Single-pole low-pass EMA with per-sample alpha derived from dt and fc. */
export function emaForward(t: number[], v: number[], fcHz: number): number[] {
  const n = v.length
  const out = new Array<number>(n)
  if (n === 0) return out
  out[0] = v[0]!
  for (let i = 1; i < n; i++) {
    const dt = Math.max((t[i]! - t[i - 1]!) / 1000, 1e-6)
    const alpha = 1 - Math.exp(-2 * Math.PI * fcHz * dt)
    out[i] = out[i - 1]! + alpha * (v[i]! - out[i - 1]!)
  }
  return out
}

/** Forward pass then backward pass — zero phase shift, steeper rolloff. */
export function smoothZeroPhase(t: number[], v: number[], fcHz: number): number[] {
  const n = v.length
  if (n === 0) return []
  const fwd = emaForward(t, v, fcHz)
  // Reverse with negated timestamps so gaps keep their size and order.
  const tRev = new Array<number>(n)
  const vRev = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    tRev[i] = -t[n - 1 - i]!
    vRev[i] = fwd[n - 1 - i]!
  }
  return emaForward(tRev, vRev, fcHz).reverse()
}

/** Central-difference derivative, units per second (t in ms). */
export function centralDiff(t: number[], v: number[]): number[] {
  const n = v.length
  const out = new Array<number>(n)
  if (n === 0) return out
  if (n === 1) {
    out[0] = 0
    return out
  }
  out[0] = ((v[1]! - v[0]!) / (t[1]! - t[0]!)) * 1000
  out[n - 1] = ((v[n - 1]! - v[n - 2]!) / (t[n - 1]! - t[n - 2]!)) * 1000
  for (let i = 1; i < n - 1; i++) {
    out[i] = ((v[i + 1]! - v[i - 1]!) / (t[i + 1]! - t[i - 1]!)) * 1000
  }
  return out
}

/** Stateful forward EMA for live streams (chart display only). */
export class LiveEma {
  private last: number | null = null
  private lastT = 0
  constructor(private fcHz: number) {}

  push(tMs: number, v: number): number {
    if (this.last === null) {
      this.last = v
      this.lastT = tMs
      return v
    }
    const dt = Math.max((tMs - this.lastT) / 1000, 1e-6)
    const alpha = 1 - Math.exp(-2 * Math.PI * this.fcHz * dt)
    this.last += alpha * (v - this.last)
    this.lastT = tMs
    return this.last
  }

  reset(): void {
    this.last = null
  }
}
