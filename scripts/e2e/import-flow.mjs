// Headless verification of the session-JSON round-trip (the regression
// harness): run a preset flow, serialize __lastReport, re-import it through
// the sidebar file input, and assert the recomputed metrics are identical.
//
//   node scripts/e2e/import-flow.mjs [--base http://localhost:5173] [--ws <url>]

import { connect, launchChrome, waitForServer } from './cdp.mjs'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : dflt
}

const base = arg('--base', 'http://localhost:5173')
const wsUrl = arg('--ws', null)

if (base.startsWith('http')) await waitForServer(base)
const chrome = wsUrl ? null : await launchChrome()
const browser = await connect(wsUrl ?? chrome.wsUrl)

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

try {
  const page = await browser.page(`${base}/?source=synthetic&preset=tap-2hz&speed=4`, { reuseFirst: !!wsUrl })
  await page.waitFor('!!window.__ctx')
  await page.eval('window.__lastReport = null')
  await page.clickButton('Start test', 'Finger Tapping Test')
  await page.waitFor('!!window.__lastReport', { timeout: 120_000, interval: 250 })

  const ok = await page.eval(`(async () => {
    const original = window.__lastReport
    const json = JSON.stringify(original)
    window.__lastReport = null
    // Drive the sidebar import input with a synthesized File.
    const file = new File([json], 'session.json', { type: 'application/json' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const input = [...document.querySelectorAll('input[type="file"]')].find((i) =>
      i.accept.includes('json'),
    )
    if (!input) return { error: 'no json file input found' }
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    // Wait for the recomputed results screen.
    for (let i = 0; i < 100 && !window.__lastReport; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    const re = window.__lastReport
    if (!re) return { error: 'import did not produce a report' }
    // The export rounds raw frames (0.1 ms / 4 dp), so velocity-family
    // metrics recompute to ~0.3% of the originals — a property of the
    // export format, present since the vanilla app. The locked contract
    // (report/export.test.ts) is: count exact, frequency to 1e-6; everything
    // else must reproduce at display precision (1% / 0.05 abs here).
    const mismatches = []
    const walk = (a, b, path) => {
      if (typeof a === 'number' && typeof b === 'number') {
        const exact = Number.isInteger(a) && Number.isInteger(b)
        // Percentage metrics (decrement, CV) are regressions over rounded
        // derivatives — near zero they wobble a few tenths of a point; the
        // UI displays them at 0 dp.
        const tol = path.endsWith('frequencyHz')
          ? 1e-6
          : /Pct$/.test(path)
            ? 0.5
            : 0.05 + 0.01 * Math.max(Math.abs(a), Math.abs(b))
        const ok2 = exact ? a === b : Math.abs(a - b) <= tol
        if (!ok2) mismatches.push(path + ': ' + a + ' != ' + b)
      } else if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path + '.' + k)
      } else if (a !== b) mismatches.push(path)
    }
    walk(original.metrics, re.metrics, 'metrics')
    return {
      mismatches: mismatches.slice(0, 5),
      count: re.metrics.count,
      countMatch: re.metrics.count === original.metrics.count,
      sameStart: re.startedAt === original.startedAt,
    }
  })()`)

  if (ok.error) fail(ok.error)
  else if (!ok.countMatch) fail('event count changed through import')
  else if (ok.mismatches.length > 0) fail(`metric mismatches: ${ok.mismatches.join('; ')}`)
  else if (!ok.sameStart) fail('startedAt not preserved through import')
  else console.log(`import-flow OK: metrics reproduce within tolerance (count=${ok.count})`)
} catch (err) {
  fail(err.message)
} finally {
  browser.close()
  chrome?.kill()
}
process.exit(process.exitCode ?? 0)
