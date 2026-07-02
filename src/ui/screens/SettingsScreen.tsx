// Settings (Phase 1 minimal scope): theme, save-video default, About.
// The full settings surface (reference thresholds, data location…) lands in
// later phases per the roadmap.

import { useEffect, useState } from 'react'
import { APP_VERSION } from '../../config'
import { isDesktop } from '../../platform'
import { getSaveVideoSetting, setSaveVideoSetting } from '../../store/subjects'
import { Card, CardDescription, CardTitle } from '../components/ui/card'
import { CheckboxRow, Field, Select } from '../components/ui/field'
import { useTheme, type ThemePref } from '../theme'

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
      <header className="mb-5">
        <h2 className="text-[22px] font-semibold tracking-tight">Settings</h2>
      </header>

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
        </Card>
      </div>
    </div>
  )
}
