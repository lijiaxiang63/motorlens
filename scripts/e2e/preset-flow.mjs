// Headless verification of the synthetic preset flow (CLAUDE.md recipe):
// open ?source=synthetic&preset=…&speed=…, click "Start test", wait for the
// results screen, dump window.__lastReport as JSON.
//
//   node scripts/e2e/preset-flow.mjs --base http://localhost:5173 \
//     --presets tap-2hz,tap-decrement,tap-hesitant,tap-slow,fist-1p5hz \
//     --out-dir /tmp/reports [--speed 4]
//
// Exits non-zero if any preset flow fails. The dumped reports are used for
// the migration metric-parity gate (diff modulo startedAt).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, launchChrome, waitForServer } from './cdp.mjs'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : dflt
}

const base = arg('--base', 'http://localhost:5173')
const speed = arg('--speed', '4')
const presets = arg('--presets', 'tap-2hz').split(',')
const outDir = arg('--out-dir', null)
const wsUrl = arg('--ws', null) // attach to an already-running browser/Electron

// Preset-name prefix → home-screen card title (clickButton matches exactly,
// including the en dashes). Extend alongside PRESET_NAMES in presets.ts.
const CARD_TITLES = [
  ['fist', 'Fist Open–Close Test'],
  ['pronosup', 'Pronation–Supination Test'],
  ['rom', 'Range of Motion Test'],
  ['tremor', 'Postural Tremor Test'],
  ['tap', 'Finger Tapping Test'],
]
const cardTitle = (preset) =>
  (CARD_TITLES.find(([prefix]) => preset.startsWith(prefix)) ?? CARD_TITLES.at(-1))[1]

await waitForServer(base)
const chrome = wsUrl ? null : await launchChrome()
const browser = await connect(wsUrl ?? chrome.wsUrl)
if (outDir) mkdirSync(outDir, { recursive: true })

let failed = 0
try {
  for (const preset of presets) {
    const page = await browser.page('about:blank')
    try {
      await page.goto(`${base}/?source=synthetic&preset=${preset}&speed=${speed}`)
      await page.waitFor('!!window.__ctx')
      await page.eval('window.__lastReport = null')
      await page.clickButton('Start test', cardTitle(preset))
      await page.waitFor('!!window.__lastReport', { timeout: 120_000, interval: 250 })
      const report = await page.eval('JSON.stringify(window.__lastReport)')
      const r = JSON.parse(report)
      const m = r.metrics
      const summary =
        typeof m.count === 'number'
          ? `count=${m.count} freq=${m.frequencyHz?.toFixed(2)}Hz ` +
            `decrement=${m.amplitudeDecrement?.regressionPct?.toFixed(1)}% ` +
            `hesitations=${m.rhythm?.hesitationCount}`
          : m.totalActiveRomDeg !== undefined
            ? `totalROM=${m.totalActiveRomDeg?.toFixed(0)}deg`
            : m.dominantFreqHz !== undefined
              ? `tremor=${m.dominantFreqHz?.toFixed(1)}Hz rms=${m.rmsAmplitudeCm?.toFixed(2)}cm index=${m.tremorIndexPct?.toFixed(0)}%`
              : 'metrics=non-cycle'
      console.log(
        `${preset}: ${summary} events=${r.events.length} frames=${r.raw.frames.length}`,
      )
      if (outDir) writeFileSync(join(outDir, `${preset}.json`), report)
    } catch (err) {
      failed++
      console.error(`${preset}: FAILED — ${err.message}`)
    }
  }
} finally {
  browser.close()
  chrome?.kill()
}
process.exit(failed > 0 ? 1 : 0)
