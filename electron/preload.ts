// contextIsolation is on and nodeIntegration is off (electron/main.ts) — this
// is the only bridge between the sandboxed renderer and the main process.
// Keep the surface minimal: app info + native save/open dialogs.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type AppInfo,
  type FileFilter,
  type OpenFileResult,
  type SaveFileRequest,
  type SaveFileResult,
  type UpdateStatus,
} from './shared'

const api = {
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  saveFile: (req: SaveFileRequest): Promise<SaveFileResult> => ipcRenderer.invoke(IPC.saveFile, req),
  openFile: (filters?: FileFilter[]): Promise<OpenFileResult | null> =>
    ipcRenderer.invoke(IPC.openFile, filters),
  // Synchronous flags read from argv (set by main.ts) — no IPC round-trip,
  // so index.html's pre-paint script can react before first render.
  flags: {
    vibrancy: process.argv.includes('--motorlens-vibrancy'),
  },
  updateCheck: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateCheck),
  updateDownload: (): Promise<void> => ipcRenderer.invoke(IPC.updateDownload),
  updateInstall: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),
  updateOpenRelease: (): Promise<void> => ipcRenderer.invoke(IPC.updateOpenRelease),
  /** Subscribes to update-status pushes from the main process; returns an
   * unsubscribe function. */
  onUpdateEvent: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: UpdateStatus) => cb(status)
    ipcRenderer.on(IPC.updateEvent, listener)
    return () => ipcRenderer.removeListener(IPC.updateEvent, listener)
  },
}

contextBridge.exposeInMainWorld('motorlens', api)

export type MotorlensApi = typeof api
