// Preset flows inside the Electron shell against the production bundle
// (app://bundle protocol — the packaged-app code path, minus code signing).
// Requires `vite build` + `build:electron` to have run.
//
//   node scripts/e2e/electron-flow.mjs --presets tap-2hz,fist-1p5hz --out-dir /tmp/reports

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from './cdp.mjs'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : dflt
}

const presets = arg('--presets', 'tap-2hz').split(',')
const outDir = arg('--out-dir', null)
if (outDir) mkdirSync(outDir, { recursive: true })

// Preset-name prefix → home-screen card title (clickButton matches exactly,
// including the en dashes). Extend alongside PRESET_NAMES in presets.ts.
const CARD_TITLES = [
  ['fist', 'Fist Open–Close Test'],
  ['pronosup', 'Pronation–Supination Test'],
  ['tap', 'Finger Tapping Test'],
]
const cardTitle = (preset) =>
  (CARD_TITLES.find(([prefix]) => preset.startsWith(prefix)) ?? CARD_TITLES.at(-1))[1]

// Launch Electron on the built bundle with the synthetic argv passthrough.
const proc = spawn(
  'npx',
  [
    'electron',
    '.',
    '--remote-debugging-port=0',
    `--source=synthetic`,
    `--preset=${presets[0]}`,
    `--speed=4`,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
const wsUrl = await new Promise((resolve, reject) => {
  let buf = ''
  const timer = setTimeout(() => reject(new Error('Electron did not start in 30 s')), 30_000)
  proc.stderr.on('data', (d) => {
    buf += d.toString()
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
    if (m) {
      clearTimeout(timer)
      resolve(m[1])
    }
  })
  proc.on('exit', (code) => reject(new Error(`Electron exited early (${code})`)))
})

const browser = await connect(wsUrl)
let failed = 0
try {
  // Reuse the app window's page target (Electron has exactly one).
  const page = await browser.page('about:blank', { reuseFirst: true })
  await page.waitFor('!!window.__ctx', { timeout: 30_000 })

  // Sanity: the self-hosted font came through the app:// protocol.
  const fontOk = await page.eval(
    `document.fonts.ready.then(() => document.fonts.check('14px "Inter Variable"'))`,
  )
  if (!fontOk) {
    failed++
    console.error('FAIL: Inter Variable did not load under app://')
  }

  for (const preset of presets) {
    try {
      await page.goto(`app://bundle/?source=synthetic&preset=${preset}&speed=4`)
      await page.waitFor('!!window.__ctx', { timeout: 30_000 })
      await page.eval('window.__lastReport = null')
      await page.clickButton('Start test', cardTitle(preset))
      await page.waitFor('!!window.__lastReport', { timeout: 120_000, interval: 250 })
      const report = await page.eval('JSON.stringify(window.__lastReport)')
      const m = JSON.parse(report).metrics
      console.log(
        `electron ${preset}: count=${m.count} freq=${m.frequencyHz?.toFixed(2)}Hz ` +
          `decrement=${m.amplitudeDecrement?.regressionPct?.toFixed(1)}%`,
      )
      if (outDir) writeFileSync(join(outDir, `${preset}.json`), report)
    } catch (err) {
      failed++
      console.error(`electron ${preset}: FAILED — ${err.message}`)
    }
  }
} finally {
  browser.close()
  proc.kill('SIGKILL')
}
process.exit(failed > 0 ? 1 : 0)
