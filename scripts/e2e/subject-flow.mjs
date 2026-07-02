// Headless verification of the subject workflow (CLAUDE.md recipe):
// subjects → create subject → checklist Start → record → results auto-save →
// IndexedDB assertions → batch ZIP export (__lastExport).
//
//   node scripts/e2e/subject-flow.mjs [--base http://localhost:5173] [--ws <url>]

import { connect, launchChrome, waitForServer } from './cdp.mjs'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : dflt
}

const base = arg('--base', 'http://localhost:5173')
const wsUrl = arg('--ws', null)
const code = `S${Date.now().toString(36).slice(-5)}`

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

  // subjects → new subject form
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

  // subject detail → the right-hand tap row (synthetic presets emit a right
  // hand; the left-hand rows would never pass the positioning gate)
  await page.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Start')`)
  await page.eval('window.__lastReport = null')
  const clicked = await page.eval(`(() => {
    const divs = [...document.querySelectorAll('div')].filter((d) =>
      d.textContent.includes('Finger Tapping Test — Right hand'),
    )
    let node = divs[divs.length - 1] // deepest match; climb to the row with the button
    while (node) {
      const btn = [...node.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start')
      if (btn) {
        btn.click()
        return true
      }
      node = node.parentElement
    }
    return false
  })()`)
  if (!clicked) fail('right-hand tap Start button not found')

  // record → results (auto-save)
  await page.waitFor('!!window.__lastReport', { timeout: 120_000, interval: 250 })
  const head = await page.eval(`(() => {
    const r = window.__lastReport
    return { subject: r.subject?.code, source: r.source?.kind, count: r.metrics.count }
  })()`)
  if (head.subject !== code) fail(`__lastReport.subject.code = ${head.subject}, expected ${code}`)
  if (head.source !== 'live') fail(`__lastReport.source.kind = ${head.source}, expected live`)
  if (head.count !== 20) fail(`tap count = ${head.count}, expected 20`)

  // saved chip appears once the IDB write lands
  await page.waitFor(
    `document.body.textContent.includes('Saved to ${code}')`,
    { timeout: 15_000 },
  )

  // IndexedDB: exactly one result for this subject
  const idb = await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['subjects', 'results'], 'readonly')
      const out = {}
      tx.objectStore('subjects').getAll().onsuccess = (e) => { out.subjects = e.target.result }
      tx.objectStore('results').getAll().onsuccess = (e) => { out.results = e.target.result }
      tx.oncomplete = () => {
        db.close()
        resolve({
          subjectCodes: out.subjects.map((s) => s.code),
          resultCount: out.results.length,
          resultTest: out.results[0]?.testId,
          resultHasReport: !!out.results[0]?.report?.raw?.frames?.length,
        })
      }
    }
  })`)
  if (!idb.subjectCodes.includes(code)) fail(`subject ${code} not in IDB (${idb.subjectCodes})`)
  if (idb.resultCount < 1) fail('no results in IDB')
  if (!idb.resultHasReport) fail('stored result has no raw frames')

  // back to subject: checklist shows the completed row
  await page.clickButton('Next test →')
  await page.waitFor(`document.body.textContent.includes('Test battery')`)
  const redo = await page.eval(
    `[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Redo').length`,
  )
  if (redo !== 1) fail(`expected 1 Redo row, got ${redo}`)

  // subjects → batch export
  await page.clickButton('← Subjects')
  await page.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Export all'))`)
  await page.eval('window.__lastExport = null')
  await page.clickButton('Export all (ZIP)')
  await page.waitFor('window.__lastExport instanceof Blob && window.__lastExport.size > 0', {
    timeout: 30_000,
  })
  const zipSize = await page.eval('window.__lastExport.size')

  console.log(
    `subject-flow OK: subject=${code} report(count=${head.count}, source=${head.source}) ` +
      `idb(results=${idb.resultCount}, test=${idb.resultTest}) zip=${zipSize}B`,
  )
} catch (err) {
  fail(err.message)
} finally {
  browser.close()
  chrome?.kill()
}
process.exit(process.exitCode ?? 0)
