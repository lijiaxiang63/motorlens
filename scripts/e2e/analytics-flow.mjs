// Headless verification of Phase 2 analytics (asymmetry / trends / compare).
// Synthetic presets emit a right hand only, so a left-hand result is seeded
// by cloning the stored right-hand row directly in IndexedDB — the same
// trick CLAUDE.md documents for exercising the left-hand battery rows.
//
//   node scripts/e2e/analytics-flow.mjs [--base http://localhost:5173] [--ws <url>]

import { connect, launchChrome, waitForServer } from './cdp.mjs'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : dflt
}

const base = arg('--base', 'http://localhost:5173')
const wsUrl = arg('--ws', null)
const code = `A${Date.now().toString(36).slice(-5)}`

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

  // --- create subject ---
  await page.clickButton('Open subjects')
  await page.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'New subject')`)
  await page.clickButton('New subject')
  await page.waitFor(`!!document.querySelector('[data-testid="subject-code"]')`)
  await page.eval(`(() => {
    const input = document.querySelector('[data-testid="subject-code"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(code)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await page.clickButton('Save subject')

  // --- right-hand tap (synthetic presets emit right hand only) ---
  await page.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Start')`)
  await page.eval('window.__lastReport = null')
  const clicked = await page.eval(`(() => {
    const divs = [...document.querySelectorAll('div')].filter((d) =>
      d.textContent.includes('Finger Tapping Test — Right hand'),
    )
    let node = divs[divs.length - 1]
    while (node) {
      const btn = [...node.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start')
      if (btn) { btn.click(); return true }
      node = node.parentElement
    }
    return false
  })()`)
  if (!clicked) fail('right-hand tap Start button not found')

  await page.waitFor('!!window.__lastReport', { timeout: 120_000, interval: 250 })
  const lastReportKeys = await page.eval('Object.keys(window.__lastReport).sort().join(",")')
  const EXPECTED_KEYS = [
    'app', 'durationMs', 'events', 'hand', 'metrics', 'quality', 'raw', 'schemaVersion',
    'series', 'source', 'startedAt', 'subject', 'test',
  ].sort().join(',')
  if (lastReportKeys !== EXPECTED_KEYS) {
    fail(`__lastReport key set changed: got [${lastReportKeys}], expected [${EXPECTED_KEYS}]`)
  }
  await page.waitFor(`document.body.textContent.includes('Saved to ${code}')`, { timeout: 15_000 })

  // --- redo the right-hand tap so a delta chip has a prior to compare to ---
  await page.clickButton('Repeat test')
  await page.waitFor('!!window.__ctx.source')
  // record screen auto-runs on the synthetic source; wait for the second report
  await page.eval('window.__lastReport = null')
  await page.waitFor('!!window.__lastReport', { timeout: 120_000, interval: 250 })
  await page.waitFor(`document.body.textContent.includes('Saved to ${code}')`, { timeout: 15_000 })

  // --- seed a left-hand result by cloning the stored right-hand row in IDB ---
  const seeded = await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['results'], 'readwrite')
      const store = tx.objectStore('results')
      store.getAll().onsuccess = (e) => {
        const rows = e.target.result
        const src = rows.find((r) => r.testId === 'finger_tap' && r.hand === 'right')
        if (!src) { reject(new Error('no right-hand tap result to clone')); return }
        const newStartedAt = new Date(new Date(src.startedAt).getTime() + 60_000).toISOString()
        const clone = {
          id: 'seeded-left-' + Math.random().toString(36).slice(2),
          subjectId: src.subjectId,
          testId: src.testId,
          hand: 'left',
          source: src.source,
          startedAt: newStartedAt,
          report: { ...src.report, hand: 'left', startedAt: newStartedAt },
        }
        store.put(clone)
      }
      tx.oncomplete = () => { db.close(); resolve(true) }
      tx.onerror = () => reject(tx.error)
    }
  })`)
  if (!seeded) fail('failed to seed left-hand result')

  // --- back to the subject hub: asymmetry card should show a paired day ---
  await page.clickButton('Next test →')
  await page.waitFor(`document.body.textContent.includes('Test battery')`)
  const asymmetry = await page.eval(`(() => {
    const el = document.querySelector('[data-testid="asymmetry-card"]')
    return el ? el.textContent : null
  })()`)
  if (!asymmetry) fail('asymmetry card not found after seeding both hands')
  else if (asymmetry.includes('Unpaired')) fail('asymmetry card still shows Unpaired after seeding both hands')

  console.log(
    `analytics-flow OK: subject=${code} __lastReport keys unchanged, asymmetry card paired`,
  )
} catch (err) {
  fail(err.message)
} finally {
  browser.close()
  chrome?.kill()
}
process.exit(process.exitCode ?? 0)
