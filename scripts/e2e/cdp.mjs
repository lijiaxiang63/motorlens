// Minimal Chrome DevTools Protocol driver — no dependencies (Node >= 22:
// native fetch + WebSocket). Used by the headless verification flows in
// scripts/e2e/*.mjs against either headless Chrome or an Electron app
// launched with --remote-debugging-port.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean)

/** Launch headless Chrome with remote debugging; resolves once the DevTools
 *  websocket endpoint is known. Returns { wsUrl, kill }. */
export async function launchChrome({ headless = true, extraArgs = [] } = {}) {
  const bin = CHROME_CANDIDATES.find(Boolean)
  if (!bin) throw new Error('No Chrome found — set CHROME_BIN')
  const profile = mkdtempSync(join(tmpdir(), 'motorlens-e2e-'))
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
    'about:blank',
  ]
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('Chrome did not start in 20 s')), 20_000)
    proc.stderr.on('data', (d) => {
      buf += d.toString()
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
    proc.on('exit', (code) => reject(new Error(`Chrome exited early (${code})`)))
  })
  return {
    wsUrl,
    kill() {
      proc.kill('SIGKILL')
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        /* profile cleanup is best-effort */
      }
    },
  }
}

/** Connect to a browser-level DevTools websocket (Chrome or Electron). */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error(`Cannot connect to ${wsUrl}`))
  })
  let nextId = 1
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.data ?? ''})`))
      else resolve(msg.result)
    }
  }
  function send(method, params = {}, sessionId) {
    const id = nextId++
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  }

  return {
    send,
    close: () => ws.close(),

    /** Open (or reuse) a page target and return a Page handle. */
    async page(url = 'about:blank', { reuseFirst = false } = {}) {
      let targetId
      if (reuseFirst) {
        const { targetInfos } = await send('Target.getTargets')
        targetId = targetInfos.find((t) => t.type === 'page')?.targetId
      }
      let reused = false
      if (!targetId) {
        ;({ targetId } = await send('Target.createTarget', { url }))
      } else {
        reused = true
      }
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
      await send('Runtime.enable', {}, sessionId)
      await send('Page.enable', {}, sessionId)
      if (reused && url && url !== 'about:blank') {
        await send('Page.navigate', { url }, sessionId)
      }

      const page = {
        sessionId,
        targetId,
        async goto(u) {
          await send('Page.navigate', { url: u }, sessionId)
        },
        /** Evaluate an expression; promises are awaited; returns the value. */
        async eval(expression) {
          const r = await send(
            'Runtime.evaluate',
            { expression, awaitPromise: true, returnByValue: true },
            sessionId,
          )
          if (r.exceptionDetails) {
            throw new Error(
              `eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
            )
          }
          return r.result?.value
        },
        /** Poll until `expression` is truthy; returns its value. */
        async waitFor(expression, { timeout = 30_000, interval = 100 } = {}) {
          const deadline = Date.now() + timeout
          for (;;) {
            const v = await page.eval(expression)
            if (v) return v
            if (Date.now() > deadline) throw new Error(`timeout waiting for: ${expression}`)
            await new Promise((r) => setTimeout(r, interval))
          }
        },
        /** Click the first <button> whose trimmed text equals `text`,
         *  optionally scoped to the card/section whose heading is `scopeHeading`. */
        async clickButton(text, scopeHeading) {
          const ok = await page.eval(`(() => {
            const withinText = (el, t) => el.textContent.trim() === t
            let scope = document
            if (${JSON.stringify(scopeHeading ?? null)}) {
              const hs = [...document.querySelectorAll('h1,h2,h3,h4')]
              const h = hs.find((x) => withinText(x, ${JSON.stringify(scopeHeading ?? '')}))
              if (!h) return false
              let node = h.parentElement
              while (node && ![...node.querySelectorAll('button')].some((b) => withinText(b, ${JSON.stringify(text)}))) {
                node = node.parentElement
              }
              if (!node) return false
              scope = node
            }
            const btn = [...scope.querySelectorAll('button')].find((b) => withinText(b, ${JSON.stringify(text)}))
            if (!btn) return false
            btn.click()
            return true
          })()`)
          if (!ok) throw new Error(`button not found: "${text}"${scopeHeading ? ` under "${scopeHeading}"` : ''}`)
        },
        async screenshot(path, { width, height } = {}) {
          if (width && height) {
            await send(
              'Emulation.setDeviceMetricsOverride',
              { width, height, deviceScaleFactor: 2, mobile: false },
              sessionId,
            )
            await new Promise((r) => setTimeout(r, 150))
          }
          const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
          const { writeFileSync } = await import('node:fs')
          writeFileSync(path, Buffer.from(data, 'base64'))
        },
      }
      return page
    },
  }
}

/** Wait until an HTTP server answers at `url`. */
export async function waitForServer(url, { timeout = 30_000 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      await fetch(url, { method: 'HEAD' })
      return
    } catch {
      if (Date.now() > deadline) throw new Error(`server not reachable: ${url}`)
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}
