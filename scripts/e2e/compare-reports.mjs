// Metric-parity comparator for SessionReport JSONs captured by
// preset-flow.mjs. Two reports of the same preset are "identical" when they
// match after normalizing out the run's absolute time base:
//
//   - `startedAt` is ignored (wall clock).
//   - every time field (`series.t`, `events[].tMs`, `raw.frames[].t`) is
//     rebased to the first raw frame — how long the app sat on the home
//     screen before the flow clicked Start shifts all timestamps by a
//     constant without changing the recorded pattern.
//   - numbers compare with atol 2e-4 (4-dp frame rounding boundaries) and
//     rtol 1e-6; integers (counts, segment indices, lengths) must be exact.
//
// Usage: node scripts/e2e/compare-reports.mjs <dirA> <dirB> [preset …]

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [dirA, dirB, ...presetArgs] = process.argv.slice(2)
if (!dirA || !dirB) {
  console.error('usage: compare-reports.mjs <dirA> <dirB> [preset …]')
  process.exit(2)
}
const presets =
  presetArgs.length > 0
    ? presetArgs
    : readdirSync(dirA)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))

function rebase(report) {
  const r = structuredClone(report)
  delete r.startedAt
  // Unrounded time fields rebase against the (unrounded) series start; the
  // exported raw frame times are rounded, so they rebase against their own
  // rounded anchor and compare with a rounding-boundary tolerance.
  const t0 = report.series?.t?.[0] ?? report.raw?.frames?.[0]?.t ?? 0
  if (r.series?.t) r.series.t = r.series.t.map((t) => t - t0)
  if (r.events) for (const e of r.events) e.tMs -= t0
  const tf0 = report.raw?.frames?.[0]?.t ?? 0
  if (r.raw?.frames) for (const f of r.raw.frames) f.t = f.t - tf0
  return r
}

const ATOL = 2e-4
const RTOL = 1e-6
/** Exported raw frame times are rounded to 0.1 ms — rebasing against a
 *  rounded anchor can flip one rounding boundary. */
const RAW_T_ATOL = 0.11

function diff(a, b, path, out) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (/\.raw\.frames\.\d+\.t$/.test(path)) {
      if (Math.abs(a - b) > RAW_T_ATOL) out.push(`${path}: ${a} != ${b}`)
      return
    }
    const exact = Number.isInteger(a) && Number.isInteger(b)
    const ok = exact
      ? a === b
      : Math.abs(a - b) <= ATOL + RTOL * Math.max(Math.abs(a), Math.abs(b))
    if (!ok) out.push(`${path}: ${a} != ${b}`)
    return
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
    return
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (!(k in a)) out.push(`${path}.${k}: missing in A`)
    else if (!(k in b)) out.push(`${path}.${k}: missing in B`)
    else diff(a[k], b[k], `${path}.${k}`, out)
  }
}

let failed = 0
for (const p of presets) {
  const a = rebase(JSON.parse(readFileSync(join(dirA, `${p}.json`), 'utf8')))
  const b = rebase(JSON.parse(readFileSync(join(dirB, `${p}.json`), 'utf8')))
  const out = []
  diff(a, b, '', out)
  if (out.length === 0) {
    console.log(`${p}: PARITY OK`)
  } else {
    failed++
    console.log(`${p}: ${out.length} mismatches`)
    for (const line of out.slice(0, 10)) console.log(`   ${line}`)
  }
}
process.exit(failed > 0 ? 1 : 0)
