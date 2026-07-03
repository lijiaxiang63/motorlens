// Headless verification of the Phase 4 assessments (pronation-supination,
// timed ROM, tremor): per-preset quick-test flows asserting each family's
// __lastReport shape and values, a pron-sup subject flow proving battery /
// asymmetry / trend flow-through (with the IDB left-hand seeding trick), and
// a clinical-PDF smoke per new family via the report route + __reportReady.
//
//   node scripts/e2e/new-assessments-flow.mjs [--base http://localhost:5173] [--ws <url>]

import { connect, launchChrome, waitForServer } from './cdp.mjs'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : dflt
}

const base = arg('--base', 'http://localhost:5173')
const wsUrl = arg('--ws', null)
const code = `N${Date.now().toString(36).slice(-5)}`

if (base.startsWith('http')) await waitForServer(base)
const chrome = wsUrl ? null : await launchChrome()
const browser = await connect(wsUrl ?? chrome.wsUrl)

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

/** Click a battery-row Start/Redo button by its "<Title> — <Hand> hand" text. */
async function startBatteryRow(page, rowText) {
  const clicked = await page.eval(`(() => {
    const divs = [...document.querySelectorAll('div')].filter((d) =>
      d.textContent.includes(${JSON.stringify(rowText)}),
    )
    let node = divs[divs.length - 1]
    while (node) {
      const btn = [...node.querySelectorAll('button')].find((b) =>
        ['Start', 'Redo'].includes(b.textContent.trim()))
      if (btn) { btn.click(); return true }
      node = node.parentElement
    }
    return false
  })()`)
  if (!clicked) throw new Error(`battery row not found: ${rowText}`)
}

/** Latest stored result id for a test id, straight from IndexedDB. */
async function storedResultId(page, testId) {
  return page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('results', 'readonly')
      tx.objectStore('results').getAll().onsuccess = (e) => {
        const rows = e.target.result.filter((r) => r.testId === ${JSON.stringify(testId)})
        rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        resolve(rows.length ? rows[rows.length - 1].id : null)
      }
      tx.oncomplete = () => db.close()
    }
  })`)
}

/** Navigate the report route and assert content once __reportReady fires. */
async function reportSmoke(page, resultId, mustContain, minPngs) {
  await page.eval('window.__reportReady = false')
  await page.eval(
    `window.__ctx.navigate({ name: 'report', kind: 'session', resultId: ${JSON.stringify(resultId)} })`,
  )
  await page.waitFor('window.__reportReady === true', { timeout: 60_000 })
  const state = await page.eval(`JSON.stringify({
    texts: ${JSON.stringify(mustContain)}.filter((t) => !document.body.textContent.includes(t)),
    pngs: [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('data:image/png')).length,
    disclaimer: document.body.textContent.includes('not validated clinical norms'),
  })`)
  const s = JSON.parse(state)
  if (s.texts.length > 0) throw new Error(`report missing text: ${s.texts.join(' | ')}`)
  if (s.pngs < minPngs) throw new Error(`report has ${s.pngs} chart PNGs, expected >= ${minPngs}`)
  if (!s.disclaimer) throw new Error('report disclaimer missing')
}

// --- Phase A: quick-test flow per preset, family-specific asserts ----------

const QUICK_CASES = [
  {
    preset: 'pronosup-1hz',
    card: 'Pronation–Supination Test',
    check(r) {
      if (r.test !== 'pronation_supination') return `test id ${r.test}`
      const m = r.metrics
      if (m.count < 9 || m.count > 11) return `count ${m.count} outside 9–11`
      if (Math.abs(m.frequencyHz - 1) > 0.05) return `freq ${m.frequencyHz}`
      if (m.cmPerUnit !== null) return 'cmPerUnit should be null for a degree signal'
      if (m.amplitudeMean < 70 || m.amplitudeMean > 88) return `amplitude ${m.amplitudeMean}`
      return null
    },
  },
  {
    preset: 'rom-sweep-timed',
    card: 'Range of Motion Test',
    check(r) {
      if (r.test !== 'rom_test') return `test id ${r.test}`
      const m = r.metrics
      if (typeof m.count !== 'undefined') return 'RomMetrics must not carry count'
      if (Object.keys(m.joints ?? {}).length !== 15) return 'expected 15 joints'
      if (Math.abs(m.totalActiveRomDeg - 890) > 25) return `total ROM ${m.totalActiveRomDeg}`
      if (r.events.length !== 0) return 'rom events must be empty'
      return null
    },
  },
  {
    preset: 'tremor-5hz',
    card: 'Postural Tremor Test',
    check(r) {
      if (r.test !== 'tremor_postural') return `test id ${r.test}`
      const m = r.metrics
      if (typeof m.count !== 'undefined') return 'TremorMetrics must not carry count'
      if (Math.abs(m.dominantFreqHz - 5) > 0.2) return `dominant ${m.dominantFreqHz}`
      const rms = 0.8 / Math.SQRT2
      if (Math.abs(m.rmsAmplitudeCm - rms) / rms > 0.15) return `rms ${m.rmsAmplitudeCm}`
      if (m.tremorIndexPct < 60) return `index ${m.tremorIndexPct}`
      if (r.durationMs !== 15000) return `duration ${r.durationMs}`
      return null
    },
  },
]

try {
  for (const { preset, card, check } of QUICK_CASES) {
    const page = await browser.page('about:blank')
    try {
      await page.goto(`${base}/?source=synthetic&preset=${preset}&speed=4`)
      await page.waitFor('!!window.__ctx')
      await page.eval('window.__lastReport = null')
      await page.clickButton('Start test', card)
      await page.waitFor('!!window.__lastReport', { timeout: 180_000, interval: 250 })
      const report = JSON.parse(await page.eval('JSON.stringify(window.__lastReport)'))
      const problem = check(report)
      if (problem) fail(`${preset}: ${problem}`)
      else console.log(`${preset}: quick-test OK (test=${report.test})`)
    } finally {
      // keep the page — the browser is shared; navigation resets state per case
    }
  }

  // --- Phase B: pron-sup subject flow — battery, seeding, asymmetry, trend --

  const page = await browser.page(`${base}/?source=synthetic&preset=pronosup-1hz&speed=4`, {
    reuseFirst: !!wsUrl,
  })
  await page.waitFor('!!window.__ctx')
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
  await page.waitFor(`document.body.textContent.includes('Pronation–Supination Test — Right hand')`)

  await page.eval('window.__lastReport = null')
  await startBatteryRow(page, 'Pronation–Supination Test — Right hand')
  await page.waitFor('!!window.__lastReport', { timeout: 180_000, interval: 250 })
  await page.waitFor(`document.body.textContent.includes('Saved to ${code}')`, { timeout: 15_000 })

  // Seed a left-hand pron-sup result (synthetic presets emit right hand only).
  await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['results'], 'readwrite')
      const store = tx.objectStore('results')
      store.getAll().onsuccess = (e) => {
        const src = e.target.result.find((r) => r.testId === 'pronation_supination' && r.hand === 'right')
        if (!src) { reject(new Error('no right-hand pron-sup result to clone')); return }
        const newStartedAt = new Date(new Date(src.startedAt).getTime() + 60_000).toISOString()
        store.put({
          id: 'seeded-left-' + Math.random().toString(36).slice(2),
          subjectId: src.subjectId,
          testId: src.testId,
          hand: 'left',
          source: src.source,
          startedAt: newStartedAt,
          report: { ...src.report, hand: 'left', startedAt: newStartedAt },
        })
      }
      tx.oncomplete = () => { db.close(); resolve(true) }
      tx.onerror = () => reject(tx.error)
    }
  })`)

  await page.clickButton('Next test →')
  await page.waitFor(`document.body.textContent.includes('Test battery')`)
  const asymmetryBlocks = await page.eval(`(() =>
    [...document.querySelectorAll('[data-testid="asymmetry-card"]')].map((el) =>
      el.textContent.slice(0, 80)))()`)
  const pronosupBlock = asymmetryBlocks.find((t) => t.includes('Pronation–Supination Test'))
  if (!pronosupBlock) fail('no Pronation–Supination asymmetry block after seeding both hands')
  else if (pronosupBlock.includes('Unpaired')) fail('pron-sup asymmetry block still Unpaired')
  const trendCells = await page.eval(
    `document.querySelectorAll('[data-testid="trend-cell"]').length`,
  )
  if (trendCells === 0) fail('no trend cell on the hub after two pron-sup results')

  // --- Phase C: clinical-PDF smoke per new family ----------------------------

  const pronosupId = await storedResultId(page, 'pronation_supination')
  if (!pronosupId) fail('no stored pron-sup result for the PDF smoke')
  else {
    await reportSmoke(
      page,
      pronosupId,
      ['Pronation–Supination Test — clinical report', 'Amplitude per event'],
      2,
    )
    console.log('pron-sup: subject flow + asymmetry/trend + PDF smoke OK')
  }

  for (const { preset, rowText, testId, mustContain, minPngs, label } of [
    {
      preset: 'rom-sweep-timed',
      rowText: 'Range of Motion Test — Right hand',
      testId: 'rom_test',
      mustContain: ['Range of Motion Test — clinical report', 'ROM per finger', 'Per-joint range'],
      minPngs: 1,
      label: 'rom',
    },
    {
      preset: 'tremor-5hz',
      rowText: 'Postural Tremor Test — Right hand',
      testId: 'tremor_postural',
      mustContain: ['Postural Tremor Test — clinical report', 'Power spectrum', 'Displacement'],
      minPngs: 2,
      label: 'tremor',
    },
  ]) {
    await page.goto(`${base}/?source=synthetic&preset=${preset}&speed=4`)
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
    if (!opened) { fail(`could not open subject ${code} for the ${label} PDF smoke`); continue }
    await page.waitFor(`document.body.textContent.includes('Test battery')`)
    await page.eval('window.__lastReport = null')
    await startBatteryRow(page, rowText)
    await page.waitFor('!!window.__lastReport', { timeout: 180_000, interval: 250 })
    await page.waitFor(`document.body.textContent.includes('Saved to ${code}')`, { timeout: 15_000 })
    const resultId = await storedResultId(page, testId)
    if (!resultId) { fail(`no stored ${testId} result for the PDF smoke`); continue }
    await reportSmoke(page, resultId, mustContain, minPngs)
    console.log(`${label}: battery row + save + PDF smoke OK`)
  }

  if (!process.exitCode) {
    console.log(
      `new-assessments-flow OK: subject=${code} — pron-sup/rom/tremor quick tests, ` +
        `pron-sup asymmetry+trend flow-through, clinical PDF smoke per family`,
    )
  }
} catch (err) {
  fail(err.message)
} finally {
  browser.close()
  chrome?.kill()
}
process.exit(process.exitCode ?? 0)
