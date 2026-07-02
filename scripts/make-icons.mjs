// Generates the MotorLens app icon (macOS .icns, Windows .ico, PNGs, and the
// browser favicon) from one hand-authored SVG. Renders via headless Chrome
// (reusing the same CDP driver as the e2e flows — no new native deps) and
// packs macOS/Windows containers with the platform's own `iconutil` and a
// zero-dependency ICO writer respectively.
//
// Outputs are committed to the repo (build/icon.png, build/icon.icns,
// build/icon.ico, public/icon.png, public/favicon.svg) so CI never needs to
// regenerate them. Re-run this script and commit the results whenever the
// icon design changes:
//
//   node scripts/make-icons.mjs
//
// macOS-only (uses `iconutil`) — matches the rest of the packaging pipeline,
// which already assumes a mac build host for `build:app`.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, connect } from './e2e/cdp.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// --- SVG design -------------------------------------------------------
// Shared hand-landmark glyph (wrist + 5 finger chains, echoing the MediaPipe
// hand graph) parametrized by direction/reach per finger so the geometry
// stays legible rather than hand-tuned pixel-by-pixel.
const PALM = { x: 512, y: 640 }
const WRIST = { x: 512, y: 810 }
const FINGERS = [
  { angle: -55, base: 95, tip: 230 }, // thumb
  { angle: -24, base: 130, tip: 330 }, // index
  { angle: -6, base: 140, tip: 350 }, // middle
  { angle: 14, base: 130, tip: 335 }, // ring
  { angle: 34, base: 115, tip: 290 }, // pinky
]

function fingerPoints() {
  return FINGERS.map(({ angle, base, tip }) => {
    const rad = (angle * Math.PI) / 180
    const dx = Math.sin(rad)
    const dy = -Math.cos(rad)
    return {
      base: { x: PALM.x + dx * base, y: PALM.y + dy * base },
      tip: { x: PALM.x + dx * tip, y: PALM.y + dy * tip },
    }
  })
}

function handGlyph({ stroke, dot, opacity = 1 }) {
  const pts = fingerPoints()
  const palmLines = pts
    .map((p) => `<line x1="${WRIST.x}" y1="${WRIST.y}" x2="${p.base.x.toFixed(1)}" y2="${p.base.y.toFixed(1)}"/>`)
    .join('')
  const fingerLines = pts
    .map(
      (p) =>
        `<line x1="${p.base.x.toFixed(1)}" y1="${p.base.y.toFixed(1)}" x2="${p.tip.x.toFixed(1)}" y2="${p.tip.y.toFixed(1)}"/>`,
    )
    .join('')
  const mcpDots = pts.map((p) => `<circle cx="${p.base.x.toFixed(1)}" cy="${p.base.y.toFixed(1)}" r="16"/>`).join('')
  const tipDots = pts.map((p) => `<circle cx="${p.tip.x.toFixed(1)}" cy="${p.tip.y.toFixed(1)}" r="22"/>`).join('')
  return `
    <g stroke="#ffffff" stroke-width="15" stroke-linecap="round" fill="none" opacity="${opacity}">
      ${palmLines}${fingerLines}
    </g>
    <g fill="#ffffff" opacity="${opacity}">
      <circle cx="${WRIST.x}" cy="${WRIST.y}" r="24"/>
      ${mcpDots}${tipDots}
    </g>`
}

/** Big-Sur-style squircle app icon: blue gradient body + glossy top sheen. */
function appIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5fb0ff"/>
        <stop offset="1" stop-color="#1d4ed8"/>
      </linearGradient>
      <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
        <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="96" y="96" width="832" height="832" rx="186" fill="url(#bg)"/>
    <rect x="96" y="96" width="832" height="832" rx="186" fill="url(#sheen)"/>
    ${handGlyph({ opacity: 0.97 })}
  </svg>`
}

/** Flat, full-bleed variant for the browser tab favicon (legible at 16px). */
function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <rect width="1024" height="1024" rx="224" fill="#2563eb"/>
    ${handGlyph({ opacity: 1 })}
  </svg>`
}

// --- Rendering (headless Chrome, reusing the e2e CDP driver) ----------

async function renderPng(browser, page, svg, size) {
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width: size, height: size, deviceScaleFactor: 1, mobile: false },
    page.sessionId,
  )
  await browser.send(
    'Emulation.setDefaultBackgroundColorOverride',
    { color: { r: 0, g: 0, b: 0, a: 0 } },
    page.sessionId,
  )
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`
  await page.goto(`data:text/html,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 60))
  const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)
  return Buffer.from(data, 'base64')
}

// --- Windows .ico (zero-dep, multi-size PNG-compressed entries) -------
// ICO's PNG-entry mode (Vista+) stores each size as a complete, independently
// decodable PNG — no BMP/DIB encoding needed.
function icoFromPngs(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  entries.forEach(({ size, png }, i) => {
    const e = dir.subarray(i * 16, i * 16 + 16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 == 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1) // height (0 == 256)
    e.writeUInt8(0, 2) // color count
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

// --- Main ---------------------------------------------------------------

const ICONSET_SIZES = [
  { file: 'icon_16x16.png', size: 16 },
  { file: 'icon_16x16@2x.png', size: 32 },
  { file: 'icon_32x32.png', size: 32 },
  { file: 'icon_32x32@2x.png', size: 64 },
  { file: 'icon_128x128.png', size: 128 },
  { file: 'icon_128x128@2x.png', size: 256 },
  { file: 'icon_256x256.png', size: 256 },
  { file: 'icon_256x256@2x.png', size: 512 },
  { file: 'icon_512x512.png', size: 512 },
  { file: 'icon_512x512@2x.png', size: 1024 },
]
const ICO_SIZES = [16, 32, 64, 256]

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('make-icons.mjs uses iconutil and is macOS-only — run it on a mac and commit the outputs.')
  }

  const { wsUrl, kill } = await launchChrome({ headless: true })
  const browser = await connect(wsUrl)
  try {
    const page = await browser.page('about:blank')
    const svg = appIconSvg()

    // Render every unique size once, keyed by size.
    const uniqueSizes = [...new Set([...ICONSET_SIZES.map((s) => s.size), ...ICO_SIZES, 1024, 512])]
    const pngBySize = new Map()
    for (const size of uniqueSizes) {
      pngBySize.set(size, await renderPng(browser, page, svg, size))
    }

    const buildDir = join(ROOT, 'build')
    const publicDir = join(ROOT, 'public')
    mkdirSync(buildDir, { recursive: true })

    // build/icon.png (1024) and public/icon.png (512, ships in dist/ for the
    // non-darwin BrowserWindow icon — see electron/main.ts).
    writeFileSync(join(buildDir, 'icon.png'), pngBySize.get(1024))
    writeFileSync(join(publicDir, 'icon.png'), pngBySize.get(512))
    console.log('[make-icons] wrote build/icon.png, public/icon.png')

    // build/icon.icns via iconutil over a temp .iconset directory.
    const iconsetDir = mkdtempSync(join(tmpdir(), 'motorlens-icon-')) + '.iconset'
    mkdirSync(iconsetDir, { recursive: true })
    for (const { file, size } of ICONSET_SIZES) {
      writeFileSync(join(iconsetDir, file), pngBySize.get(size))
    }
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', join(buildDir, 'icon.icns')])
    rmSync(iconsetDir, { recursive: true, force: true })
    console.log('[make-icons] wrote build/icon.icns')

    // build/icon.ico (multi-size, zero-dep).
    const ico = icoFromPngs(ICO_SIZES.map((size) => ({ size, png: pngBySize.get(size) })))
    writeFileSync(join(buildDir, 'icon.ico'), ico)
    console.log('[make-icons] wrote build/icon.ico')

    // public/favicon.svg — committed as source; browsers render SVG
    // favicons natively, no rasterization needed.
    writeFileSync(join(publicDir, 'favicon.svg'), faviconSvg())
    console.log('[make-icons] wrote public/favicon.svg')
  } finally {
    browser.close()
    kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
