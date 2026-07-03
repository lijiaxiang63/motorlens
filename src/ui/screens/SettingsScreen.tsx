// Settings: theme, save-video default, reference cues (Phase 3), About.
// Data-location reveal is the remaining item from the roadmap's full scope.

import { useEffect, useState } from 'react'
import {
  DEFAULT_REFERENCE_THRESHOLDS,
  type MetricThreshold,
  type ReferenceThresholds,
} from '../../analysis/thresholds'
import { CATALOG_GROUPS, type MetricKey } from '../../analysis/metricCatalog'
import { APP_VERSION } from '../../config'
import { isDesktop, type UpdateStatus } from '../../platform'
import {
  getReferenceThresholds,
  getSaveVideoSetting,
  setReferenceThresholds,
  setSaveVideoSetting,
} from '../../store/subjects'
import { Button } from '../components/ui/button'
import { Card, CardDescription, CardFooter, CardTitle } from '../components/ui/card'
import { CheckboxRow, Field, Input, Select } from '../components/ui/field'
import { PageHeader } from '../components/PageHeader'
import { useTheme, type ThemePref } from '../theme'

type BoundKind = 'warnBelow' | 'warnAbove'

function inputsFrom(t: ReferenceThresholds): Record<string, string> {
  const out: Record<string, string> = {}
  for (const group of CATALOG_GROUPS) {
    for (const def of group.defs) {
      out[`${def.key}:warnBelow`] = t[def.key]?.warnBelow?.toString() ?? ''
      out[`${def.key}:warnAbove`] = t[def.key]?.warnAbove?.toString() ?? ''
    }
  }
  return out
}

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
  const [thresholds, setThresholds] = useState<ReferenceThresholds | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    void getSaveVideoSetting().then((v) => {
      if (!cancelled) setSaveVideo(v)
    })
    void getReferenceThresholds().then((t) => {
      if (cancelled) return
      setThresholds(t)
      setInputs(inputsFrom(t))
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

  /** Parses the field's text and commits (persists + normalizes the display
   *  value); an empty or non-numeric entry clears that bound. */
  function commitBound(key: MetricKey, kind: BoundKind, text: string) {
    const trimmed = text.trim()
    const parsed = trimmed === '' ? undefined : Number(trimmed)
    const value = parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined

    setThresholds((prev) => {
      const base: ReferenceThresholds = { ...(prev ?? {}) }
      const entry: MetricThreshold = { ...base[key] }
      if (value === undefined) delete entry[kind]
      else entry[kind] = value
      if (entry.warnBelow === undefined && entry.warnAbove === undefined) delete base[key]
      else base[key] = entry
      void setReferenceThresholds(base).catch(() => {})
      return base
    })
    setInputs((prev) => ({ ...prev, [`${key}:${kind}`]: value !== undefined ? String(value) : '' }))
  }

  function resetThresholdsToDefaults() {
    setThresholds(DEFAULT_REFERENCE_THRESHOLDS)
    setInputs(inputsFrom(DEFAULT_REFERENCE_THRESHOLDS))
    void setReferenceThresholds(DEFAULT_REFERENCE_THRESHOLDS).catch(() => {})
  }

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
          <CardTitle>Reference cues</CardTitle>
          <CardDescription>
            Flags a metric on results screens and clinical PDF reports when it crosses a
            threshold you set here. These are user-configurable reference cues, not validated
            clinical norms.
          </CardDescription>
          {thresholds !== null && (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="grid grid-cols-[1fr_92px_92px] gap-2 px-1 text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">
                <span>Metric</span>
                <span>Warn below</span>
                <span>Warn above</span>
              </div>
              {CATALOG_GROUPS.map((group) => (
                <div key={group.family} className="contents">
                  {/* Group headings only once a second family's catalog exists —
                      with a single group this renders exactly the flat list. */}
                  {CATALOG_GROUPS.length > 1 && (
                    <div className="mt-2 px-1 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground first:mt-0">
                      {group.title}
                    </div>
                  )}
                  {group.defs.map((def) => (
                    <div key={def.key} className="grid grid-cols-[1fr_92px_92px] items-center gap-2">
                      <span className="text-[13px] text-foreground">
                        {def.label}
                        {def.unit ? ` (${def.unit.trim()})` : ''}
                      </span>
                      <Input
                        type="number"
                        step="any"
                        aria-label={`${def.label} warn below`}
                        value={inputs[`${def.key}:warnBelow`] ?? ''}
                        onChange={(e) =>
                          setInputs((prev) => ({ ...prev, [`${def.key}:warnBelow`]: e.target.value }))
                        }
                        onBlur={(e) => commitBound(def.key, 'warnBelow', e.target.value)}
                      />
                      <Input
                        type="number"
                        step="any"
                        aria-label={`${def.label} warn above`}
                        value={inputs[`${def.key}:warnAbove`] ?? ''}
                        onChange={(e) =>
                          setInputs((prev) => ({ ...prev, [`${def.key}:warnAbove`]: e.target.value }))
                        }
                        onBlur={(e) => commitBound(def.key, 'warnAbove', e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <CardFooter>
            <span className="text-xs text-muted-foreground">
              Every report and flagged card carries a disclaimer that these are not diagnostic
              norms.
            </span>
            <Button variant="ghost" size="sm" onClick={resetThresholdsToDefaults}>
              Reset to defaults
            </Button>
          </CardFooter>
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
