// Headless verification of the clinical PDF report route (Phase 3).
// Browser leg only — the Electron leg (`--electron`, MOTORLENS_PDF_OUT) is
// added in Phase 3e once electron/pdf.ts exists.
//
//   node scripts/e2e/pdf-flow.mjs [--base http://localhost:5173] [--ws <url>]

import { connect, launchChrome, waitForServer } from './cdp.mjs'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : dflt
}

const base = arg('--base', 'http://localhost:5173')
const wsUrl = arg('--ws', null)
const code = `R${Date.now().toString(36).slice(-5)}`

if (base.startsWith('http')) await waitForServer(base)
const chrome = wsUrl ? null : await launchChrome()
const browser = await connect(wsUrl ?? chrome.wsUrl)

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

async function idbGetAllResults(page) {
  return page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['results'], 'readonly')
      tx.objectStore('results').getAll().onsuccess = (e) => {
        db.close()
        resolve(e.target.result)
      }
    }
  })`)
}

async function putSetting(page, key, value) {
  await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['settings'], 'readwrite')
      tx.objectStore('settings').put({ key: ${JSON.stringify(key)}, value: ${JSON.stringify(value)} })
      tx.oncomplete = () => { db.close(); resolve(true) }
    }
  })`)
}

async function deleteSetting(page, key) {
  await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['settings'], 'readwrite')
      tx.objectStore('settings').delete(${JSON.stringify(key)})
      tx.oncomplete = () => { db.close(); resolve(true) }
    }
  })`)
}

try {
  const page = await browser.page(`${base}/?source=synthetic&preset=tap-2hz&speed=4`, { reuseFirst: !!wsUrl })
  await page.waitFor('!!window.__ctx')

  // --- create subject, record a right-hand tap (synthetic emits right only) ---
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
  await page.waitFor(`document.body.textContent.includes('Saved to ${code}')`, { timeout: 15_000 })

  const [stored] = await idbGetAllResults(page)
  if (!stored) fail('no stored result found after recording')
  const resultId = stored.id
  const subjectId = stored.subjectId
  const beforeJson = JSON.stringify(stored)

  // --- stub window.print (headless Chrome has no print UI to click through) ---
  await page.eval(`window.__printCalls = 0; window.print = () => { window.__printCalls++ }`)

  // --- navigate to the session report route ---
  await page.eval(`window.__reportReady = false`)
  await page.eval(`window.__ctx.navigate({ name: 'report', kind: 'session', resultId: ${JSON.stringify(resultId)} })`)
  await page.waitFor('window.__reportReady === true', { timeout: 30_000 })

  const bodyText = await page.eval('document.body.textContent')
  if (!bodyText.includes('20')) fail('report does not show the expected tap count (20)')
  if (!bodyText.includes('2.00 Hz')) fail('report does not show the expected frequency (2.00 Hz)')
  if (!bodyText.includes('not validated clinical norms')) fail('report is missing the disclaimer')
  const imgCount = await page.eval(`[...document.querySelectorAll('img')].filter(
    img => img.src.startsWith('data:image/png') && img.src.length > 1000,
  ).length`)
  if (imgCount < 2) fail(`expected >=2 chart PNG images, got ${imgCount}`)

  // --- real bytes via CDP Page.printToPDF (validates the print CSS as actual output) ---
  const pdf = await browser.send(
    'Page.printToPDF',
    { printBackground: true, preferCSSPageSize: true },
    page.sessionId,
  )
  const pdfBytes = Buffer.from(pdf.data, 'base64')
  if (!pdfBytes.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
    fail('printToPDF output does not start with the %PDF magic bytes')
  }
  if (pdfBytes.length < 1000) fail(`printToPDF output suspiciously small (${pdfBytes.length} bytes)`)

  // --- Save PDF button falls back to window.print() in the browser build ---
  await page.clickButton('Save PDF')
  const printCalls = await page.eval('window.__printCalls')
  if (printCalls !== 1) fail(`expected window.print() called once, got ${printCalls}`)

  // --- export never mutates the stored result ---
  const [afterStored] = await idbGetAllResults(page)
  if (JSON.stringify(afterStored) !== beforeJson) {
    fail('stored result changed after generating its report')
  }

  // --- default thresholds: decrement cue present but unflagged on a clean 2hz run ---
  const decrementFlaggedByDefault = await page.eval(`(() => {
    const row = [...document.querySelectorAll('[data-testid="report-metric-row"]')].find(
      (r) => r.dataset.metricKey === 'ampDecrementPct',
    )
    return row?.dataset.flagged === 'true'
  })()`)
  if (decrementFlaggedByDefault) fail('a clean tap-2hz run should not flag Amplitude decrement by default')

  // --- user-configured threshold flags the Frequency row on the next render ---
  await putSetting(page, 'referenceThresholds', { frequencyHz: { warnBelow: 3 } })
  await page.eval(`window.__reportReady = false`)
  await page.eval(`window.__ctx.navigate({ name: 'report', kind: 'session', resultId: ${JSON.stringify(resultId)} })`)
  await page.waitFor('window.__reportReady === true', { timeout: 30_000 })
  const freqFlagged = await page.eval(`(() => {
    const row = [...document.querySelectorAll('[data-testid="report-metric-row"]')].find(
      (r) => r.dataset.metricKey === 'frequencyHz',
    )
    return row?.dataset.flagged === 'true' && row.textContent.includes('< 3 Hz')
  })()`)
  if (!freqFlagged) fail('frequencyHz.warnBelow=3 did not flag the Frequency row in the report')

  // clearing the setting un-flags it
  await deleteSetting(page, 'referenceThresholds')
  await page.eval(`window.__reportReady = false`)
  await page.eval(`window.__ctx.navigate({ name: 'report', kind: 'session', resultId: ${JSON.stringify(resultId)} })`)
  await page.waitFor('window.__reportReady === true', { timeout: 30_000 })
  const freqFlaggedAfterClear = await page.eval(`(() => {
    const row = [...document.querySelectorAll('[data-testid="report-metric-row"]')].find(
      (r) => r.dataset.metricKey === 'frequencyHz',
    )
    return row?.dataset.flagged === 'true'
  })()`)
  if (freqFlaggedAfterClear) fail('Frequency row still flagged after clearing the threshold')

  // --- subject report: one result -> no asymmetry/trends sections, one sessions row ---
  await page.eval(`window.__reportReady = false`)
  await page.eval(`window.__ctx.navigate({ name: 'report', kind: 'subject', subjectId: ${JSON.stringify(subjectId)} })`)
  await page.waitFor('window.__reportReady === true', { timeout: 30_000 })
  const singleResultState = await page.eval(`({
    hasAsymmetry: !!document.querySelector('[data-testid="report-asymmetry"]'),
    sessionRows: document.querySelectorAll('[data-testid="report-session-row"]').length,
  })`)
  if (singleResultState.hasAsymmetry) fail('subject report shows an asymmetry section with only one result')
  if (singleResultState.sessionRows !== 1) {
    fail(`expected exactly 1 sessions row with one stored result, got ${singleResultState.sessionRows}`)
  }

  // --- seed a left-hand clone (analytics-flow.mjs technique) -> asymmetry section appears ---
  await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['results'], 'readwrite')
      const store = tx.objectStore('results')
      store.getAll().onsuccess = (e) => {
        const src = e.target.result.find((r) => r.testId === 'finger_tap' && r.hand === 'right')
        const newStartedAt = new Date(new Date(src.startedAt).getTime() + 60_000).toISOString()
        store.put({
          ...src,
          id: 'seeded-left-' + Math.random().toString(36).slice(2),
          hand: 'left',
          startedAt: newStartedAt,
          report: { ...src.report, hand: 'left', startedAt: newStartedAt },
        })
      }
      tx.oncomplete = () => { db.close(); resolve(true) }
    }
  })`)
  await page.eval(`window.__reportReady = false`)
  await page.eval(`window.__ctx.navigate({ name: 'report', kind: 'subject', subjectId: ${JSON.stringify(subjectId)} })`)
  await page.waitFor('window.__reportReady === true', { timeout: 30_000 })
  const hasAsymmetryNow = await page.eval(`!!document.querySelector('[data-testid="report-asymmetry"]')`)
  if (!hasAsymmetryNow) fail('subject report does not show an asymmetry section after seeding both hands')

  console.log(
    `pdf-flow OK: subject=${code} report renders (count/freq/disclaimer/charts), printToPDF bytes valid, ` +
      `export never mutated the stored result, threshold flag/clear works, subject report degrades then shows asymmetry`,
  )
} catch (err) {
  fail(err.message)
} finally {
  browser.close()
  chrome?.kill()
}
process.exit(process.exitCode ?? 0)
