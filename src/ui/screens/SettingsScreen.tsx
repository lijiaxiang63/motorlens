// Settings (Phase 1 minimal scope): theme, save-video default, About.
// The full settings surface (reference thresholds, data location…) lands in
// later phases per the roadmap.

import { useEffect, useState } from 'react'
import { APP_VERSION } from '../../config'
import { isDesktop, type UpdateStatus } from '../../platform'
import { getSaveVideoSetting, setSaveVideoSetting } from '../../store/subjects'
import { Button } from '../components/ui/button'
import { Card, CardDescription, CardTitle } from '../components/ui/card'
import { CheckboxRow, Field, Select } from '../components/ui/field'
import { PageHeader } from '../components/PageHeader'
import { useTheme, type ThemePref } from '../theme'

/** "Check for updates" row inside the About card — desktop only. Renders
 * nothing until the bridge's update methods exist (older preload / browser
 * build). See electron/updater.ts for the state machine. */
function UpdateRow() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    const bridge = window.motorlens
    if (!bridge?.onUpdateEvent) return
    return bridge.onUpdateEvent(setStatus)
  }, [])

  const bridge = window.motorlens
  if (!bridge?.updateCheck) return null

  const busy = status?.state === 'checking' || status?.state === 'downloading'

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t pt-3">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void bridge.updateCheck!()}>
        {status?.state === 'checking' ? 'Checking…' : 'Check for updates'}
      </Button>
      <span className="text-[12.5px] text-muted-foreground">
        {status?.state === 'dev' && 'Auto-update is disabled in dev builds.'}
        {status?.state === 'not-available' && 'You’re up to date.'}
        {status?.state === 'error' && `Update check failed: ${status.error}`}
        {status?.state === 'downloaded' && 'Update ready — restart to install.'}
        {status?.state === 'downloading' && `Downloading update… ${Math.round(status.percent ?? 0)}%`}
        {status?.state === 'available' &&
          (status.canInstall
            ? `Update ${status.version} available.`
            : `Update ${status.version} available — download from GitHub.`)}
      </span>
      {status?.state === 'available' && !status.canInstall && (
        <Button variant="ghost" size="sm" onClick={() => void bridge.updateOpenRelease!()}>
          Download from GitHub
        </Button>
      )}
      {status?.state === 'available' && status.canInstall && (
        <Button variant="ghost" size="sm" onClick={() => void bridge.updateDownload!()}>
          Download update
        </Button>
      )}
      {status?.state === 'downloaded' && (
        <Button variant="primary" size="sm" onClick={() => void bridge.updateInstall!()}>
          Restart to update
        </Button>
      )}
    </div>
  )
}

export function SettingsScreen() {
  const { pref, setPref } = useTheme()
  const [saveVideo, setSaveVideo] = useState<boolean | null>(null)
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getSaveVideoSetting().then((v) => {
      if (!cancelled) setSaveVideo(v)
    })
    if (isDesktop()) {
      void window.motorlens
        ?.appInfo()
        .then((info) => {
          if (!cancelled) setDesktopVersion(`${info.version} (${info.platform})`)
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto max-w-[720px] px-6 pb-12 pt-6">
      <PageHeader title="Settings" />

      <div className="flex flex-col gap-3">
        <Card>
          <CardTitle>Appearance</CardTitle>
          <Field label="Theme" className="mt-3 max-w-56">
            <Select value={pref} onChange={(e) => setPref(e.target.value as ThemePref)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">Follow system</option>
            </Select>
          </Field>
        </Card>

        <Card>
          <CardTitle>Recording</CardTitle>
          {saveVideo !== null && (
            <CheckboxRow
              checked={saveVideo}
              onChange={(v) => {
                setSaveVideo(v)
                void setSaveVideoSetting(v).catch(() => {})
              }}
              className="mt-3"
            >
              Save camera video with each subject test (default for new sessions)
            </CheckboxRow>
          )}
        </Card>

        <Card>
          <CardTitle>About</CardTitle>
          <CardDescription>
            MotorLens {APP_VERSION}
            {desktopVersion ? ` · desktop ${desktopVersion}` : ' · browser'}
            <br />
            Camera-based hand motor function assessment. MotorLens is an assessment aid, not a
            diagnostic device. All processing happens on this device; no video or data leaves your
            computer.
          </CardDescription>
          <UpdateRow />
        </Card>
      </div>
    </div>
  )
}
