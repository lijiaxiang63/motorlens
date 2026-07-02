// Electron shell around the unmodified web app. Two ways to load the
// renderer:
//   - dev (ELECTRON_RENDERER_URL set): points at the running Vite dev
//     server, so `npm run dev:app` behaves exactly like `npm run dev`.
//   - packaged: serves dist/ from a privileged `app://bundle` origin so the
//     ROOT-ABSOLUTE MediaPipe asset paths (/mediapipe/wasm, .../*.task) and
//     their `fetch(..., {method:'HEAD'})` probe in
//     src/tracking/handLandmarker.ts keep working unmodified, and so
//     IndexedDB has a stable, permanent origin. `app://bundle` must never
//     change — the origin IS the IndexedDB identity for every subject
//     recorded in the packaged app.
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  systemPreferences,
} from 'electron'
import { IPC, type SaveFileRequest } from './shared'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true, // getUserMedia requires a secure context
      supportFetchAPI: true, // routes renderer fetch() — incl. the HEAD probe — through our handler
      stream: true,
      codeCache: true,
      corsEnabled: true,
    },
  },
])

const DIST_DIR = path.join(__dirname, '..', 'dist')
const APP_ORIGIN = 'app://bundle'

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath)] ?? 'application/octet-stream'
}

function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.includes('..')) return new Response('Forbidden', { status: 403 })
    if (pathname === '' || pathname === '/') pathname = '/index.html'

    let filePath = path.join(DIST_DIR, pathname)
    if (!existsSync(filePath) || (await fs.stat(filePath)).isDirectory()) {
      // SPA fallback (e.g. a pathless deep link) — index.html re-parses
      // location.search itself, so query params survive this redirect.
      filePath = path.join(DIST_DIR, 'index.html')
    }

    const stat = await fs.stat(filePath)
    const headers = {
      'Content-Type': mimeFor(filePath),
      'Content-Length': String(stat.size),
    }
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })

    const data = await fs.readFile(filePath)
    return new Response(new Uint8Array(data), { status: 200, headers })
  })
}

// --- Window bounds persistence (hand-rolled — no dependency needed for one JSON file) ---

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
}

function stateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

async function loadWindowState(): Promise<WindowState> {
  try {
    const raw = await fs.readFile(stateFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<WindowState>
    return { width: parsed.width ?? 1280, height: parsed.height ?? 820, x: parsed.x, y: parsed.y }
  } catch {
    return { width: 1280, height: 820 }
  }
}

function saveWindowState(win: BrowserWindow): void {
  const bounds = win.getBounds()
  void fs.writeFile(stateFile(), JSON.stringify(bounds)).catch(() => {})
}

// --- Headless-harness argv passthrough (CLAUDE.md flows: ?source=synthetic&preset=...) ---

// Only forward the query params src/main.ts actually reads — an unfiltered
// pass-through would also leak Electron/Chromium's own CLI switches (e.g.
// --remote-debugging-port) into the page URL.
const FORWARDED_PARAMS = new Set(['source', 'preset', 'speed'])

function argvQueryString(): string {
  const args = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2)
  const params = new URLSearchParams()
  for (const arg of args) {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (m && FORWARDED_PARAMS.has(m[1]!)) params.set(m[1]!, m[2]!)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function ensureCameraAccess(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (systemPreferences.getMediaAccessStatus('camera') === 'granted') return
  await systemPreferences.askForMediaAccess('camera')
}

let win: BrowserWindow | null = null

async function createWindow(): Promise<void> {
  const state = await loadWindowState()

  win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#0e1116', // matches --bg; avoids a white flash on load
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win?.show())
  win.on('close', () => win && saveWindowState(win))
  win.on('closed', () => {
    win = null
  })
  // Surfaces renderer console output (incl. the MediaPipe local/CDN-fallback
  // warning) in the main process log — useful for support and for the
  // headless-harness verification flows described in CLAUDE.md.
  win.webContents.on('console-message', (details) => {
    console.log(`[renderer:${details.level}] ${details.message}`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    console.error(`[main] did-fail-load code=${code} desc=${desc} url=${url}`),
  )
  win.webContents.on('render-process-gone', (_e, details) =>
    console.error(`[main] render-process-gone reason=${details.reason}`),
  )

  const devUrl = process.env.ELECTRON_RENDERER_URL
  const query = argvQueryString()
  if (devUrl) {
    await win.loadURL(devUrl + query)
  } else {
    await win.loadURL(`${APP_ORIGIN}/index.html${query}`)
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion(), platform: process.platform }))

  ipcMain.handle(IPC.saveFile, async (_evt, req: SaveFileRequest) => {
    if (!win) return { saved: false }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: req.defaultName,
      filters: req.filters,
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await fs.writeFile(result.filePath, Buffer.from(req.data))
    return { saved: true, path: result.filePath }
  })

  ipcMain.handle(IPC.openFile, async (_evt, filters: SaveFileRequest['filters']) => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]!
    const data = await fs.readFile(filePath)
    return {
      name: path.basename(filePath),
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    }
  })
}

app.whenReady().then(async () => {
  registerAppProtocol()
  registerIpcHandlers()

  // Camera-only permission grants; everything else is denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  await ensureCameraAccess()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
