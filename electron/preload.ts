// contextIsolation is on and nodeIntegration is off (electron/main.ts) — this
// is the only bridge between the sandboxed renderer and the main process.
// Keep the surface minimal: app info + native save/open dialogs.

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppInfo, type FileFilter, type OpenFileResult, type SaveFileRequest, type SaveFileResult } from './shared'

const api = {
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  saveFile: (req: SaveFileRequest): Promise<SaveFileResult> => ipcRenderer.invoke(IPC.saveFile, req),
  openFile: (filters?: FileFilter[]): Promise<OpenFileResult | null> =>
    ipcRenderer.invoke(IPC.openFile, filters),
}

contextBridge.exposeInMainWorld('motorlens', api)

export type MotorlensApi = typeof api
