// Headless verification of Phase 2d: batch ZIP export -> wipe IndexedDB ->
// backup import -> IDB restored identically -> re-import is idempotent ->
// re-export produces an equivalent summary.csv.
//
//   node scripts/e2e/backup-flow.mjs [--base http://localhost:5173] [--ws <url>]

import { strFromU8, unzipSync } from 'fflate'
import { connect, launchChrome, waitForServer } from './cdp.mjs'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : dflt
}

const base = arg('--base', 'http://localhost:5173')
const wsUrl = arg('--ws', null)
const code = `B${Date.now().toString(36).slice(-5)}`

if (base.startsWith('http')) await waitForServer(base)
const chrome = wsUrl ? null : await launchChrome()
const browser = await connect(wsUrl ?? chrome.wsUrl)

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

/** Base64-encode a page-side Blob and return the bytes in node. */
async function blobBytes(page, expr) {
  const b64 = await page.eval(`(async () => {
    const buf = await (${expr}).arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    return btoa(binary)
  })()`)
  return Buffer.from(b64, 'base64')
}

async function snapshotIdb(page) {
  return page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['subjects', 'results', 'videos'], 'readonly')
      const out = {}
      tx.objectStore('subjects').getAll().onsuccess = (e) => { out.subjects = e.target.result }
      tx.objectStore('results').getAll().onsuccess = (e) => { out.results = e.target.result }
      tx.objectStore('videos').getAll().onsuccess = (e) => { out.videos = e.target.result }
      tx.oncomplete = () => {
        db.close()
        resolve({
          subjectCodes: out.subjects.map((s) => s.code).sort(),
          resultCount: out.results.length,
          resultSummaries: out.results
            .map((r) => \`\${r.testId}|\${r.hand}|\${r.report.metrics.count}|\${r.report.metrics.frequencyHz}\`)
            .sort(),
          videoKeys: out.videos.map((v) => v.key).sort(),
        })
      }
    }
  })`)
}

try {
  const page = await browser.page(`${base}/?source=synthetic&preset=tap-2hz&speed=4`, { reuseFirst: !!wsUrl })
  await page.waitFor('!!window.__ctx')

  // --- create a subject with one right-hand tap result ---
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
  await page.eval(`(() => {
    const divs = [...document.querySelectorAll('div')].filter((d) => d.textContent.includes('Finger Tapping Test — Right hand'))
    let node = divs[divs.length - 1]
    while (node) {
      const btn = [...node.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start')
      if (btn) { btn.click(); break }
      node = node.parentElement
    }
  })()`)
  await page.waitFor('!!window.__lastReport', { timeout: 120_000, interval: 250 })
  await page.waitFor(`document.body.textContent.includes('Saved to ${code}')`, { timeout: 15_000 })

  const before = await snapshotIdb(page)
  if (before.resultCount < 1) fail('no result recorded before export')

  // --- export all (ZIP) ---
  await page.clickButton('Next test →')
  await page.waitFor(`document.body.textContent.includes('Test battery')`)
  await page.clickButton('← Subjects')
  await page.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Export all'))`)
  await page.eval('window.__lastExport = null')
  await page.clickButton('Export all (ZIP)')
  await page.waitFor('window.__lastExport instanceof Blob && window.__lastExport.size > 0', { timeout: 30_000 })
  const export1Bytes = await blobBytes(page, 'window.__lastExport')

  // --- wipe IndexedDB via a fresh connection (deleteDatabase would block on
  // the app's own open connection) ---
  await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['subjects', 'results', 'videos'], 'readwrite')
      tx.objectStore('subjects').clear()
      tx.objectStore('results').clear()
      tx.objectStore('videos').clear()
      tx.oncomplete = () => { db.close(); resolve(true) }
      tx.onerror = () => reject(tx.error)
    }
  })`)
  await page.eval(`window.__ctx.navigate({ name: 'home' })`)
  await page.eval(`window.__ctx.navigate({ name: 'subjects' })`)
  const wiped = await snapshotIdb(page)
  if (wiped.subjectCodes.length !== 0) fail('IDB not wiped before import')

  // --- import the exported ZIP back in, via the same File+DataTransfer
  // pattern import-flow.mjs uses for JSON ---
  async function feedZipInput(bytes) {
    const b64 = bytes.toString('base64')
    await page.eval(`(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0))
      const file = new File([bytes], 'backup.zip', { type: 'application/zip' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const input = [...document.querySelectorAll('input[type="file"]')].find((i) => i.accept.includes('zip'))
      if (!input) throw new Error('no zip file input found')
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
  }
  await feedZipInput(export1Bytes)
  await page.waitFor(`document.body.textContent.includes('Imported')`, { timeout: 30_000 })

  const restored = await snapshotIdb(page)
  if (JSON.stringify(restored) !== JSON.stringify(before)) {
    fail(
      `IDB after import doesn't match pre-export snapshot.\nbefore=${JSON.stringify(before)}\nrestored=${JSON.stringify(restored)}`,
    )
  }

  // --- re-importing the same ZIP is idempotent ---
  await feedZipInput(export1Bytes)
  await page.waitFor(`document.body.textContent.includes('already present')`, { timeout: 30_000 })
  const afterSecondImport = await snapshotIdb(page)
  if (JSON.stringify(afterSecondImport) !== JSON.stringify(before)) {
    fail('re-importing the same backup changed IDB contents (not idempotent)')
  }

  // --- re-export produces an equivalent summary.csv ---
  await page.eval('window.__lastExport = null')
  await page.clickButton('Export all (ZIP)')
  await page.waitFor('window.__lastExport instanceof Blob && window.__lastExport.size > 0', { timeout: 30_000 })
  const export2Bytes = await blobBytes(page, 'window.__lastExport')
  const csv1 = strFromU8(unzipSync(export1Bytes)['summary.csv'])
  const csv2 = strFromU8(unzipSync(export2Bytes)['summary.csv'])
  if (csv1 !== csv2) fail('re-export summary.csv differs from the original export')

  console.log(
    `backup-flow OK: subject=${code} exported+wiped+imported identically, idempotent re-import, ` +
      `re-export summary.csv equal`,
  )
} catch (err) {
  fail(err.message)
} finally {
  browser.close()
  chrome?.kill()
}
process.exit(process.exitCode ?? 0)
