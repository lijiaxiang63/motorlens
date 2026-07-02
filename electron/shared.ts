// IPC channel names and payload contracts shared between main and preload.
// The renderer (src/platform.ts) only sees the shape through window.motorlens
// — it never imports this file, so it stays usable from the browser build.

export const IPC = {
  appInfo: 'motorlens:app-info',
  saveFile: 'motorlens:save-file',
  openFile: 'motorlens:open-file',
} as const

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface AppInfo {
  version: string
  platform: NodeJS.Platform
}

export interface SaveFileRequest {
  defaultName: string
  data: ArrayBuffer
  filters?: FileFilter[]
}

export interface SaveFileResult {
  saved: boolean
  path?: string
}

export interface OpenFileResult {
  name: string
  data: ArrayBuffer
}
