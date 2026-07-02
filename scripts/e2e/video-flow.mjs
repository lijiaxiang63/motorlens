// Headless smoke test of the video-upload path (CLAUDE.md recipe): record a
// canvas captureStream into a webm File, navigate to videoReview, add a
// manual segment (no hands detected → 0 auto-segments), analyze, and assert
// the result persisted. Exercises processing, review UI, manual segments,
// analysis, persistence, and the MediaRecorder Infinity-duration workaround.
//
//   node scripts/e2e/video-flow.mjs [--base http://localhost:5173] [--ws <url>]

import { connect, launchChrome, waitForServer } from './cdp.mjs'

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : dflt
}

const base = arg('--base', 'http://localhost:5173')
const wsUrl = arg('--ws', null)
const code = `V${Date.now().toString(36).slice(-5)}`

await waitForServer(base)
const chrome = wsUrl ? null : await launchChrome()
const browser = await connect(wsUrl ?? chrome.wsUrl)

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

try {
  const page = await browser.page(`${base}/?source=synthetic&preset=tap-2hz&speed=4`)
  await page.waitFor('!!window.__ctx')

  // Record a 3 s canvas webm and stage it on window.__testFile.
  await page.eval(`(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 240
    const g = canvas.getContext('2d')
    let t = 0
    const timer = setInterval(() => {
      t += 1
      g.fillStyle = '#123'
      g.fillRect(0, 0, 320, 240)
      g.fillStyle = '#fff'
      g.beginPath()
      g.arc(160 + 80 * Math.sin(t / 5), 120, 24, 0, 7)
      g.fill()
    }, 33)
    const stream = canvas.captureStream(30)
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    const done = new Promise((r) => { rec.onstop = r })
    rec.start(500)
    await new Promise((r) => setTimeout(r, 3000))
    rec.stop()
    await done
    clearInterval(timer)
    window.__testFile = new File(chunks, 'synthetic-test.webm', { type: 'video/webm' })
    return window.__testFile.size
  })()`)

  // Create the subject through the real UI so it exists in IDB.
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
  await page.waitFor(`document.body.textContent.includes('Test battery')`)

  // Into video review with the staged file (upload picker can't be driven
  // headlessly; __ctx.navigate is the documented harness entry).
  const subjectId = await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      db.transaction('subjects').objectStore('subjects').getAll().onsuccess = (e) => {
        db.close()
        resolve(e.target.result.find((s) => s.code === ${JSON.stringify(code)})?.id)
      }
    }
  })`)
  if (!subjectId) fail('subject not created')
  await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onsuccess = () => {
      const db = req.result
      db.transaction('subjects').objectStore('subjects').get(${JSON.stringify(subjectId)}).onsuccess = (e) => {
        db.close()
        window.__ctx.navigate({ name: 'videoReview', subject: e.target.result, file: window.__testFile })
        resolve(true)
      }
    }
    req.onerror = () => reject(req.error)
  })`)

  // Processing → review (0 auto-segments for a hand-free video).
  await page.waitFor(
    `[...document.querySelectorAll('button')].some(b => b.textContent.includes('segment') || b.textContent.includes('Add segment'))`,
    { timeout: 120_000, interval: 500 },
  )
  const auto = await page.eval(
    `document.body.textContent.match(/(\\d+) segments? auto-detected/)?.[1] ?? '0'`,
  )

  // Add a manual segment at the playhead and analyze.
  await page.clickButton('Add segment at playhead')
  await page.waitFor(`document.body.textContent.includes('Segment 1 of')`)
  await page.eval('window.__lastNotice = null')
  const analyzeLabel = await page.eval(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Analyze'))?.textContent.trim()`,
  )
  if (!analyzeLabel) fail('analyze button not found')
  await page.clickButton(analyzeLabel)

  // Back on the subject screen with the success notice.
  await page.waitFor(`document.body.textContent.includes('Added 1 result')`, { timeout: 60_000 })

  const idb = await page.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('motorlens')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['results', 'videos'], 'readonly')
      const out = {}
      tx.objectStore('results').getAll().onsuccess = (e) => {
        out.results = e.target.result.filter((r) => r.subjectId === ${JSON.stringify(subjectId)})
      }
      tx.objectStore('videos').getAll().onsuccess = (e) => { out.videos = e.target.result }
      tx.oncomplete = () => {
        db.close()
        resolve({
          resultCount: out.results.length,
          source: out.results[0]?.source,
          videoKey: out.results[0]?.videoKey,
          videoStored: out.videos.some((v) => v.key === out.results[0]?.videoKey),
          detectionRate: out.results[0]?.report?.quality?.detectionRate,
        })
      }
    }
  })`)
  if (idb.resultCount !== 1) fail(`expected 1 stored result, got ${idb.resultCount}`)
  if (idb.source !== 'video') fail(`result source = ${idb.source}, expected video`)
  if (!idb.videoKey || !idb.videoStored) fail('uploaded video not stored with the result')
  if (idb.detectionRate !== 0) fail(`detectionRate = ${idb.detectionRate}, expected 0 (no hands)`)

  console.log(
    `video-flow OK: auto-segments=${auto} stored(source=${idb.source}, video=${idb.videoStored}, detection=${idb.detectionRate})`,
  )
} catch (err) {
  fail(err.message)
} finally {
  browser.close()
  chrome?.kill()
}
process.exit(process.exitCode ?? 0)
