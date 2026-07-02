// IPC channel names and payload contracts shared between main and preload.
// The renderer (src/platform.ts) only sees the shape through window.motorlens
// — it never imports this file, so it stays usable from the browser build.

export const IPC = {
  appInfo: 'motorlens:app-info',
  saveFile: 'motorlens:save-file',
  openFile: 'motorlens:open-file',
  updateCheck: 'motorlens:update-check',
  updateDownload: 'motorlens:update-download',
  updateInstall: 'motorlens:update-install',
  updateOpenRelease: 'motorlens:update-open-release',
  /** Push-only: main -> renderer, whenever `UpdateStatus` changes. */
  updateEvent: 'motorlens:update-event',
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

// --- Auto-update -----------------------------------------------------
// See electron/updater.ts for the state machine. Two delivery paths share
// this one status shape: the full electron-updater flow (Windows now; mac
// once code-signed — see MAC_FULL_UPDATER) and a check-only GitHub-API path
// for the unsigned mac build (electron-updater's Mac installer requires a
// valid code signature, so unsigned macOS just notifies + deep-links to the
// release page instead of downloading in-app).

export type UpdateState =
  | 'idle'
  | 'dev'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  /** Latest available version, once known. */
  version?: string
  /** Download progress percent (0-100), while `state === 'downloading'`. */
  percent?: number
  /** GitHub release page — set on the check-only (unsigned mac) path. */
  releaseUrl?: string
  /** True when `updateDownload`/`updateInstall` will actually do something
   * (the full electron-updater path); false on the check-only path. */
  canInstall?: boolean
  error?: string
}
