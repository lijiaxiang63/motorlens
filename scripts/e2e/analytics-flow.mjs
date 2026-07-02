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

  const deltaChipCount = await page.eval(
    `document.querySelectorAll('[data-testid="delta-chip"]').length`,
  )
  if (deltaChipCount === 0) fail('no delta chip found on the results screen after a second same-test run')

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

  // --- trend grid: a sparkline cell for the two right-hand runs, click through ---
  const trendCellCount = await page.eval(`document.querySelectorAll('[data-testid="trend-cell"]').length`)
  if (trendCellCount === 0) fail('no trend-cell found on the subject hub')
  else {
    await page.eval(`document.querySelector('[data-testid="trend-cell"]').click()`)
    await page.waitFor(`!!document.querySelector('select')`, { timeout: 10_000 })
    const sessionRows = await page.eval(
      `document.querySelectorAll('.divide-y.divide-border > button').length`,
    )
    if (sessionRows < 2) fail(`trend session table has ${sessionRows} rows, expected >= 2`)
    await page.eval(`document.querySelector('.divide-y.divide-border > button').click()`)
    await page.waitFor(`document.body.textContent.includes('Export JSON')`, { timeout: 10_000 })
  }

  // --- back to the hub, then reload with a decrement preset for a 3rd right-hand run ---
  await page.clickButton('Next test →')
  await page.waitFor(`document.body.textContent.includes('Test battery')`)
  await page.goto(`${base}/?source=synthetic&preset=tap-decrement&speed=4`)
  await page.waitFor('!!window.__ctx')
  await page.clickButton('Open subjects')
  await page.waitFor(`document.body.textContent.includes(${JSON.stringify(code)})`, { timeout: 15_000 })
  const opened = await page.eval(`(() => {
    const rows = [...document.querySelectorAll('div')].filter((d) => d.textContent.includes(${JSON.stringify(code)}))
    let node = rows[rows.length - 1]
    while (node) {
      const btn = [...node.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open')
      if (btn) { btn.click(); return true }
      node = node.parentElement
    }
    return false
  })()`)
  if (!opened) fail(`could not find/open subject ${code} after reload`)
  await page.waitFor(`document.body.textContent.includes('Test battery')`)
  await page.eval('window.__lastReport = null')
  const redone = await page.eval(`(() => {
    const divs = [...document.querySelectorAll('div')].filter((d) =>
      d.textContent.includes('Finger Tapping Test — Right hand'),
    )
    let node = divs[divs.length - 1]
    while (node) {
      const btn = [...node.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Redo')
      if (btn) { btn.click(); return true }
      node = node.parentElement
    }
    return false
  })()`)
  if (!redone) fail('right-hand tap Redo button not found after reload')
  await page.waitFor('!!window.__lastReport', { timeout: 120_000, interval: 250 })
  await page.waitFor(`document.body.textContent.includes('Saved to ${code}')`, { timeout: 15_000 })
  await page.clickButton('Next test →')
  await page.waitFor(`document.body.textContent.includes('Test battery')`)

  // --- select two right-hand tap results (2hz run + the new decrement run) and compare ---
  const checkboxCount = await page.eval(
    `document.querySelectorAll('[data-testid="compare-checkbox"]').length`,
  )
  if (checkboxCount < 2) fail(`expected >=2 comparable result checkboxes, got ${checkboxCount}`)
  await page.eval(`(() => {
    const boxes = [...document.querySelectorAll('[data-testid="compare-checkbox"]')]
    boxes[0].click()
    boxes[1].click()
  })()`)
  await page.waitFor(
    `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Compare selected')`,
  )
  await page.clickButton('Compare selected')
  await page.waitFor(`document.body.textContent.includes('Compare results')`, { timeout: 10_000 })

  const decrementRow = await page.eval(`(() => {
    const labelSpan = [...document.querySelectorAll('span')].find(
      (s) => s.textContent.trim() === 'Amplitude decrement',
    )
    if (!labelSpan) return null
    return [...labelSpan.parentElement.children].map((c) => c.textContent.trim())
  })()`)
  if (!decrementRow) {
    fail('Amplitude decrement row not found in the compare table')
  } else {
    const nums = [decrementRow[1], decrementRow[2]].map((t) => parseFloat(t))
    const hasLow = nums.some((n) => Math.abs(n) < 10)
    const hasHigh = nums.some((n) => n > 20 && n < 40)
    if (!hasLow || !hasHigh) fail(`decrement row values unexpected: [${decrementRow.join(', ')}]`)
  }
  const canvasCount = await page.eval(`document.querySelectorAll('canvas').length`)
  if (canvasCount < 2) fail(`expected >=2 overlay canvases on the compare screen, got ${canvasCount}`)

  // --- deleting a compared result navigates back gracefully (never a crash) ---
  await page.clickButton(`← ${code}`)
  await page.waitFor(`document.body.textContent.includes('Test battery')`)
  const ids = await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['subjects', 'results'], 'readonly')
      const out = {}
      tx.objectStore('subjects').getAll().onsuccess = (e) => {
        out.subjectId = e.target.result.find((s) => s.code === ${JSON.stringify(code)})?.id
      }
      tx.objectStore('results').getAll().onsuccess = (e) => {
        const rows = e.target.result.filter((r) => r.testId === 'finger_tap' && r.hand === 'right')
        out.ids = rows.map((r) => r.id)
      }
      tx.oncomplete = () => { db.close(); resolve(out) }
    }
  })`)
  if (!ids.subjectId || (ids.ids ?? []).length < 2) {
    fail('could not resolve subject/result ids for the delete-then-compare check')
  } else {
    const [aId, bId] = ids.ids
    await page.eval(`new Promise((resolve, reject) => {
      const req = indexedDB.open('motorlens')
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['results'], 'readwrite')
        tx.objectStore('results').delete(${JSON.stringify(aId)})
        tx.oncomplete = () => { db.close(); resolve(true) }
      }
    })`)
    await page.eval(
      `window.__ctx.navigate({ name: 'compare', subjectId: ${JSON.stringify(ids.subjectId)}, aId: ${JSON.stringify(aId)}, bId: ${JSON.stringify(bId)} })`,
    )
    await page.waitFor(`document.body.textContent.includes('Test battery')`, { timeout: 10_000 })
    const noticeShown = await page.eval(
      `document.body.textContent.includes('A compared result was deleted')`,
    )
    if (!noticeShown) fail('expected a notice after navigating to a compare route with a deleted result')
  }

  console.log(
    `analytics-flow OK: subject=${code} __lastReport keys unchanged, asymmetry card paired, ` +
      `trend click-through works, compare table + overlays render, deleted-result compare bounces back gracefully`,
  )
} catch (err) {
  fail(err.message)
} finally {
  browser.close()
  chrome?.kill()
}
process.exit(process.exitCode ?? 0)
