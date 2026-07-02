// Clinical PDF export (Phase 3e): a hidden BrowserWindow at the same
// app://bundle origin (so it reads the same IndexedDB the visible window
// does) loads the report route, waits for the renderer's `reportReady` ping,
// then Chromium's printToPDF — which applies @media print, the same path a
// real Print dialog takes, so the browser (window.print()) and desktop
// paths paginate identically. Saved via MOTORLENS_PDF_OUT (headless e2e,
// since a native save dialog can't be driven over CDP) or the native
// save-dialog, mirroring the saveFile handler in electron/main.ts.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, type ExportPdfRequest, type ExportPdfResult } from './shared'

const VALID_KINDS = new Set(['session', 'subject'])
const ID_PATTERN = /^[\w-]+$/
const READY_TIMEOUT_MS = 30_000

/** Resolves once the hidden window with this webContents id sends
 *  `reportReady` — keyed so a late/duplicate ping (e.g. a stray one from the
 *  main window's own report route, or a StrictMode double-effect in dev) is
 *  a harmless no-op rather than resolving the wrong export. */
const readyWaiters = new Map<number, () => void>()

export function registerPdfHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.on(IPC.reportReady, (event) => {
    readyWaiters.get(event.sender.id)?.()
  })

  let inFlight = false

  ipcMain.handle(IPC.exportPdf, async (_evt, req: ExportPdfRequest): Promise<ExportPdfResult> => {
    if (!VALID_KINDS.has(req.kind)) return { saved: false, error: 'Invalid report kind' }
    if (!ID_PATTERN.test(req.id)) return { saved: false, error: 'Invalid report id' }
    if (inFlight) return { saved: false, error: 'A PDF export is already in progress' }
    inFlight = true

    const hidden = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })

    try {
      const query = `?report=${req.kind}&id=${encodeURIComponent(req.id)}`
      const devUrl = process.env.ELECTRON_RENDERER_URL
      const loadUrl = devUrl ? devUrl + query : `app://bundle/index.html${query}`

      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Report did not finish rendering in time')),
          READY_TIMEOUT_MS,
        )
        readyWaiters.set(hidden.webContents.id, () => {
          clearTimeout(timer)
          resolve()
        })
      })

      await hidden.loadURL(loadUrl)
      await ready

      const pdfBuffer = await hidden.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      })

      const outPath = process.env.MOTORLENS_PDF_OUT
      if (outPath) {
        // Headless e2e hook — a native save dialog can't be driven over CDP.
        await fs.writeFile(outPath, pdfBuffer)
        return { saved: true, path: outPath }
      }

      const mainWindow = getMainWindow()
      if (!mainWindow) return { saved: false, error: 'No window to attach the save dialog to' }
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: req.defaultName,
        filters: [{ name: 'PDF document', extensions: ['pdf'] }],
      })
      if (result.canceled || !result.filePath) return { saved: false }
      await fs.writeFile(result.filePath, pdfBuffer)
      return { saved: true, path: result.filePath }
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      readyWaiters.delete(hidden.webContents.id)
      hidden.destroy()
      inFlight = false
    }
  })
}
