// Shared results-screen chrome: page header (title/description/actions/saved
// chip), the quality-warning strip, and the notes card. Family views render
// their metric/chart layouts between these pieces. Family-specific warnings
// (e.g. cycle's "very few events") arrive via `extraWarnings`, spliced before
// the video-capture warning to keep the original ordering.

import { HAND_SCALE_CV_WARN_PCT } from '../../../config'
import { downloadReport } from '../../../report/export'
import { getSaveVideoSetting } from '../../../store/subjects'
import type { QualityMetrics, SessionReport } from '../../../types'
import { Button } from '../../components/ui/button'
import { Card, CardDescription, CardTitle } from '../../components/ui/card'
import { Textarea } from '../../components/ui/field'
import { PageHeader } from '../../components/PageHeader'
import { StatusChip } from '../../components/StatusChip'
import { fmt } from '../../format'
import { useNav, type ResultProps } from '../../nav'

export function sharedQualityWarnings(
  q: QualityMetrics,
  r: ResultProps,
  extraWarnings: string[],
): string[] {
  const warnings: string[] = []
  if (q.detectionRate < 0.9) {
    warnings.push(
      `Hand tracking was lost for ${(100 - q.detectionRate * 100).toFixed(0)}% of the test — results may be incomplete.`,
    )
  }
  if (q.handScaleCvPct > HAND_SCALE_CV_WARN_PCT) {
    warnings.push(
      `Hand position varied a lot during the test (scale CV ${q.handScaleCvPct.toFixed(0)}%) — for best tracking, keep a steady distance from the camera.`,
    )
  }
  if (q.meanFps < 15) {
    warnings.push(
      `Low frame rate (${q.meanFps.toFixed(0)} fps) — fast movements may be undersampled.`,
    )
  }
  warnings.push(...extraWarnings)
  if (r.videoCaptureFailed) {
    warnings.push('Video capture failed on this device — the result was saved without a video.')
  }
  return warnings
}

export function ResultHeader({
  result: r,
  report,
  notes,
  resultId,
  savedChip,
  extraWarnings = [],
}: {
  result: ResultProps
  report: SessionReport
  notes: string
  resultId: string | null
  savedChip: { state: 'ok' | 'err'; text: string } | null
  extraWarnings?: string[]
}) {
  const { navigate } = useNav()
  const { def, hand } = r
  const q = r.analysis.quality

  async function repeatTest() {
    if (r.subject) {
      const saveVideoPref = await getSaveVideoSetting().catch(() => true)
      navigate({
        name: 'record',
        def,
        hand,
        subjectCtx: { subject: r.subject, saveVideo: saveVideoPref },
      })
    } else {
      navigate({ name: 'record', def, hand })
    }
  }

  const startedDate = new Date(r.startedAt)
  const subjectBit = r.subject ? `${r.subject.code} · ` : ''
  const sourceBit = r.source?.kind === 'video' ? ` · from ${r.source.fileName ?? 'video file'}` : ''
  const warnings = sharedQualityWarnings(q, r, extraWarnings)

  return (
    <>
      <PageHeader
        className="mb-4"
        title={`${def.title} — results`}
        description={
          <>
            {subjectBit}
            {hand === 'left' ? 'Left' : 'Right'} hand · {startedDate.toLocaleString()} ·{' '}
            {fmt(q.meanFps, 0)} fps · {(q.detectionRate * 100).toFixed(0)}% detection
            {sourceBit}
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => void downloadReport(notes ? { ...report, notes } : report)}
            >
              Export JSON
            </Button>
            <Button variant="ghost" onClick={() => window.print()}>
              Print
            </Button>
            {resultId && (
              <Button
                variant="ghost"
                onClick={() => navigate({ name: 'report', kind: 'session', resultId })}
              >
                Report (PDF)
              </Button>
            )}
            <Button variant="ghost" onClick={() => void repeatTest()}>
              Repeat test
            </Button>
            {r.subject && (
              <Button
                variant="primary"
                onClick={() => navigate({ name: 'subject', subjectId: r.subject!.id })}
              >
                Next test →
              </Button>
            )}
            <Button
              variant={r.subject ? 'ghost' : 'primary'}
              onClick={() => navigate({ name: 'home' })}
            >
              Home
            </Button>
          </>
        }
      >
        {savedChip && (
          <StatusChip state={savedChip.state} className="mt-1.5">
            {savedChip.text}
          </StatusChip>
        )}
      </PageHeader>

      {warnings.length > 0 && (
        <div className="mb-4 flex flex-col gap-1 rounded-xl border border-warn/45 bg-warn-surface px-3.5 py-2.5 text-[13.5px] text-warn">
          {warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}
    </>
  )
}

export function ResultNotesCard({
  notes,
  resultId,
  onChange,
  onBlur,
}: {
  notes: string
  resultId: string | null
  onChange(text: string): void
  onBlur(): void
}) {
  return (
    <Card className="mt-5">
      <CardTitle>Notes</CardTitle>
      <Textarea
        className="mt-2"
        rows={3}
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="Optional note for this session…"
      />
      <CardDescription>
        {resultId ? 'Saved with this result.' : 'Included in the exported JSON for this session.'}
      </CardDescription>
    </Card>
  )
}

export function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-[0.8px] text-muted-foreground">
      {children}
    </h3>
  )
}
