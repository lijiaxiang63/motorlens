// Auto-update. Two delivery paths, selected once at startup by `fullUpdater`:
//
//  - Windows (and macOS once code-signed — flip MAC_FULL_UPDATER): the real
//    electron-updater flow against the GitHub Releases feed embedded in
//    `app-update.yml` by electron-builder's `publish` config (package.json).
//    autoDownload is off — the renderer drives check -> download -> install.
//  - Unsigned macOS today: electron-updater's Mac installer (Squirrel.Mac)
//    validates a code signature before it will install, so an unsigned
//    build can never actually self-update. Instead this path polls the
//    GitHub "latest release" API directly and, if newer, surfaces a
//    "download from GitHub" deep link (`shell.openExternal`) — no in-app
//    download/install.
//
// Dev builds (`!app.isPackaged`) no-op to `state: 'dev'` unless a test hook
// env var is set (see the two overrides below) — that's how this is
// verified headlessly without publishing a release.
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC, type UpdateStatus } from './shared'

const GITHUB_OWNER = 'lijiaxiang63'
const GITHUB_REPO = 'motorlens'

// Test hook: point the check-only path at a local fixture server instead of
// the real GitHub API (scripts/e2e has no camera/GUI to click "check for
// updates", so this env var is how that flow gets exercised headlessly).
const RELEASE_API =
  process.env.MOTORLENS_RELEASE_API ?? `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

// Flip to true once the mac build is code-signed + notarized in CI (Phase
// 5's electron-builder `identity`/`hardenedRuntime` config would need a real
// Developer ID at that point too — see CLAUDE.md).
const MAC_FULL_UPDATER = false

const fullUpdater = process.platform === 'win32' || (process.platform === 'darwin' && MAC_FULL_UPDATER)

let status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion() }

function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

export function initUpdater(getWin: () => BrowserWindow | null): void {
  const push = (next: Partial<UpdateStatus>) => {
    status = { ...status, ...next }
    getWin()?.webContents.send(IPC.updateEvent, status)
  }

  if (fullUpdater) {
    autoUpdater.autoDownload = false
    // Test hook: point the full electron-updater path at a local generic
    // feed (a directory served over HTTP containing latest.yml + the
    // installer) instead of GitHub — lets the download/install flow be
    // exercised without publishing a real release.
    if (process.env.MOTORLENS_UPDATE_FEED) {
      autoUpdater.forceDevUpdateConfig = true
      autoUpdater.setFeedURL({ provider: 'generic', url: process.env.MOTORLENS_UPDATE_FEED })
    }
    autoUpdater.on('checking-for-update', () => push({ state: 'checking' }))
    autoUpdater.on('update-available', (info) => push({ state: 'available', version: info.version, canInstall: true }))
    autoUpdater.on('update-not-available', () => push({ state: 'not-available' }))
    autoUpdater.on('download-progress', (p) => push({ state: 'downloading', percent: p.percent }))
    autoUpdater.on('update-downloaded', () => push({ state: 'downloaded' }))
    autoUpdater.on('error', (err) => push({ state: 'error', error: err?.message ?? String(err) }))
  }

  async function check(): Promise<UpdateStatus> {
    const devOverride = process.env.MOTORLENS_UPDATE_FEED ?? process.env.MOTORLENS_RELEASE_API
    if (!app.isPackaged && !devOverride) {
      push({ state: 'dev' })
      return status
    }
    push({ state: 'checking' })
    try {
      if (fullUpdater) {
        await autoUpdater.checkForUpdates() // events (above) drive the rest of the status
      } else {
        const res = await fetch(RELEASE_API, { headers: { accept: 'application/vnd.github+json' } })
        if (!res.ok) throw new Error(`GitHub API ${res.status}`)
        const rel = (await res.json()) as { tag_name: string; html_url: string }
        const latest = rel.tag_name.replace(/^v/, '')
        if (semverGt(latest, app.getVersion())) {
          push({ state: 'available', version: latest, releaseUrl: rel.html_url, canInstall: false })
        } else {
          push({ state: 'not-available' })
        }
      }
    } catch (err) {
      push({ state: 'error', error: err instanceof Error ? err.message : String(err) })
    }
    return status
  }

  ipcMain.handle(IPC.updateCheck, () => check())
  ipcMain.handle(IPC.updateDownload, () => {
    if (fullUpdater) void autoUpdater.downloadUpdate()
  })
  ipcMain.handle(IPC.updateInstall, () => {
    if (fullUpdater) autoUpdater.quitAndInstall()
  })
  ipcMain.handle(IPC.updateOpenRelease, () => {
    if (status.releaseUrl) void shell.openExternal(status.releaseUrl)
  })

  // Launch check — silent unless it finds something (no toast/dialog for
  // "you're up to date" on every cold start).
  if (app.isPackaged) setTimeout(() => void check(), 3_000)
}
