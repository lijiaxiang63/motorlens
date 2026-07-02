/** '—' for null/NaN, fixed decimals + optional unit otherwise. */
export function fmt(x: number | null | undefined, digits = 1, unit = ''): string {
  if (x == null || !Number.isFinite(x)) return '—'
  return x.toFixed(digits) + unit
}

/** m:ss for a millisecond duration (video review timeline). */
export function fmtTime(ms: number): string {
  const s = Math.max(ms, 0) / 1000
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
