// Pure presentational print document — static markup only, no interactive
// controls. `button` is hidden globally under @media print (tokens.css), so
// any interactive chrome here would silently vanish when actually printed;
// the toolbar (Save PDF / Back) lives one level up in ReportScreen instead.
// Every element uses only the `.report-light`-scoped token utilities — no
// `dark:` variants — so the document renders identically regardless of the
// app's current theme.

import { formatAsymmetryValue, type AsymmetryRow } from '../../analysis/asymmetry'
import { METRIC_CATALOG, metricByKey } from '../../analysis/metricCatalog'
import type {
  ReportMetricRow,
  SessionReportModel,
  SubjectReportModel,
} from '../../report/clinical'
import { Sparkline } from '../components/Sparkline'

/** The subject summary's per-hand "latest" card shows only the curated
 *  headline subset (the same `spark` metrics the trend sparkline grid uses)
 *  — the full 12-metric breakdown lives in the per-session report. */
const SPARK_KEYS = new Set(METRIC_CATALOG.filter((d) => d.spark).map((d) => d.key))

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-2 mt-6 text-[13px] font-semibold uppercase tracking-[0.8px] text-muted-foreground first:mt-0">
      {children}
    </h2>
  )
}

function MetricTable({ rows }: { rows: ReportMetricRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border" style={{ breakInside: 'avoid' }}>
      <div className="grid grid-cols-[1fr_110px_110px] gap-2 border-b bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        <span>Metric</span>
        <span className="text-right">Value</span>
        <span className="text-right">Ref. cue</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          data-testid="report-metric-row"
          data-metric-key={row.key}
          data-flagged={row.flag ? 'true' : 'false'}
          className="grid grid-cols-[1fr_110px_110px] items-center gap-2 border-b px-3 py-1 text-[12.5px] last:border-b-0"
        >
          <span className="text-muted-foreground">{row.label}</span>
          <span
            className={
              'text-right tabular-nums font-medium ' + (row.flag ? 'text-warn' : 'text-foreground')
            }
          >
            {row.display}
          </span>
          <span className="text-right text-[11px] text-muted-foreground">{row.cue ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

function QualityStrip({ quality }: { quality: { label: string; value: string }[] }) {
  if (quality.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
      {quality.map((q) => (
        <span key={q.label}>
          {q.label}: <span className="font-medium text-foreground">{q.value}</span>
        </span>
      ))}
    </div>
  )
}

function Disclaimer({ text }: { text: string }) {
  return (
    <p className="mt-6 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground" style={{ breakInside: 'avoid' }}>
      {text}
    </p>
  )
}

function AsymmetryBarRow({ row }: { row: AsymmetryRow }) {
  const def = metricByKey(row.key)
  const denom = Math.max(Math.abs(row.left ?? 0), Math.abs(row.right ?? 0), 1e-9)
  const leftPct = row.left !== null ? (Math.abs(row.left) / denom) * 100 : 0
  const rightPct = row.right !== null ? (Math.abs(row.right) / denom) * 100 : 0
  return (
    <div className="grid grid-cols-[130px_1fr_70px] items-center gap-2 py-1 text-[12px]">
      <span className="truncate text-muted-foreground">{def.label}</span>
      <div className="flex h-3 items-center">
        <div className="flex flex-1 justify-end">
          {row.left !== null && (
            <div className="h-1.5 rounded-l-[3px] bg-chart-left" style={{ width: `${leftPct}%` }} />
          )}
        </div>
        <div className="h-2.5 w-px shrink-0 bg-border-strong" />
        <div className="flex flex-1 justify-start">
          {row.right !== null && (
            <div className="h-1.5 rounded-r-[3px] bg-chart-right" style={{ width: `${rightPct}%` }} />
          )}
        </div>
      </div>
      <span className="text-right tabular-nums text-muted-foreground">
        {row.value === null ? '—' : formatAsymmetryValue(def, row)}
      </span>
    </div>
  )
}

export function SessionReportDocument({
  model,
  signalPng,
  amplitudePng,
}: {
  model: SessionReportModel
  signalPng: string
  amplitudePng: string
}) {
  const { header } = model
  return (
    <div className="report-light mx-auto max-w-[680px] bg-surface p-6 text-foreground">
      {/* A plain div, not a <header> element — @media print's blanket
          `header { display: none }` rule (meant for the app shell's top bar)
          would otherwise hide the report's own title too. */}
      <div className="mb-4" style={{ breakInside: 'avoid' }}>
        <h1 className="text-[19px] font-semibold tracking-tight">{header.testTitle} — clinical report</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {header.subjectCode ? `${header.subjectCode} · ` : ''}
          {header.hand === 'left' ? 'Left' : 'Right'} hand · {new Date(header.startedAt).toLocaleString()}{' '}
          · {(header.durationMs / 1000).toFixed(0)} s
          {header.source === 'video' && header.sourceFileName ? ` · from ${header.sourceFileName}` : ''}
        </p>
        {header.subjectLine && <p className="text-[12.5px] text-muted-foreground">{header.subjectLine}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">MotorLens {header.appVersion}</p>
      </div>

      <QualityStrip quality={model.quality} />
      {model.qualityWarnings.length > 0 && (
        <div className="mb-3 rounded-lg border border-warn/45 bg-warn-surface px-3 py-2 text-[12px] text-warn">
          {model.qualityWarnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}

      <SectionTitle>Metrics</SectionTitle>
      <p className="mb-2 -mt-1 text-[11px] text-muted-foreground">
        Ref. cue values are user-configurable reference cues, not validated clinical norms.
      </p>
      <MetricTable rows={model.metrics} />

      <SectionTitle>Signal</SectionTitle>
      <img src={signalPng} alt="Recorded signal with event markers" className="w-full rounded-lg border" style={{ breakInside: 'avoid' }} />

      <SectionTitle>Amplitude per event</SectionTitle>
      <img src={amplitudePng} alt="Amplitude per event with decrement trend" className="w-full rounded-lg border" style={{ breakInside: 'avoid' }} />

      {model.notes && (
        <>
          <SectionTitle>Notes</SectionTitle>
          <p className="whitespace-pre-wrap rounded-lg border bg-surface-2 p-3 text-[12.5px]">
            {model.notes}
          </p>
        </>
      )}

      <Disclaimer text={model.disclaimer} />
    </div>
  )
}

export function SubjectReportDocument({ model }: { model: SubjectReportModel }) {
  return (
    <div className="report-light mx-auto max-w-[680px] bg-surface p-6 text-foreground">
      <div className="mb-4" style={{ breakInside: 'avoid' }}>
        <h1 className="text-[19px] font-semibold tracking-tight">{model.subject.code} — subject summary</h1>
        {model.subject.line && <p className="mt-1 text-[12.5px] text-muted-foreground">{model.subject.line}</p>}
        {model.subject.notes && (
          <p className="mt-1 text-[12.5px] text-muted-foreground">Notes: {model.subject.notes}</p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Generated {new Date(model.generatedAt).toLocaleString()} · MotorLens {model.appVersion}
        </p>
      </div>

      {model.tests.map((test) => (
        <div key={test.testId} style={{ breakInside: 'avoid' }}>
          <SectionTitle>{test.testTitle}</SectionTitle>

          <div className="mb-3 flex flex-col gap-3 sm:flex-row">
            {test.latest.map((l) => (
              <div key={l.hand} className="flex-1 rounded-lg border p-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <i
                    className="inline-block size-2 rounded-full"
                    style={{ background: l.hand === 'left' ? 'var(--chart-left)' : 'var(--chart-right)' }}
                  />
                  {l.hand === 'left' ? 'Left' : 'Right'} hand · {new Date(l.startedAt).toLocaleDateString()}
                </div>
                <MetricTable rows={l.metrics.filter((m) => SPARK_KEYS.has(m.key))} />
              </div>
            ))}
          </div>

          {test.trends.length > 0 && (
            <div className="mb-3 grid grid-cols-2 gap-3">
              {test.trends.map((t) => (
                <div key={t.key} className="rounded-lg border p-2">
                  <div className="mb-1 text-[11px] text-muted-foreground">{t.label}</div>
                  <Sparkline series={t.series} width={280} height={40} />
                </div>
              ))}
            </div>
          )}

          {test.asymmetry && (
            <div className="mb-3 rounded-lg border p-2.5" data-testid="report-asymmetry">
              <div className="mb-1 text-[11px] text-muted-foreground">
                L/R asymmetry — {new Date(`${test.asymmetry.dayKey}T00:00:00`).toLocaleDateString()} (positive = right larger)
              </div>
              <div className="flex flex-col divide-y divide-border">
                {test.asymmetry.rows.map((row) => (
                  <AsymmetryBarRow key={row.key} row={row} />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <SectionTitle>Sessions</SectionTitle>
      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[1fr_60px_70px_1fr] gap-2 border-b bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          <span>Date · test</span>
          <span>Hand</span>
          <span>Source</span>
          <span>Summary / notes</span>
        </div>
        {model.sessions.map((s, i) => (
          <div
            key={`${s.startedAt}-${i}`}
            data-testid="report-session-row"
            className="grid grid-cols-[1fr_60px_70px_1fr] gap-2 border-b px-3 py-1 text-[12px] last:border-b-0"
            style={{ breakInside: 'avoid' }}
          >
            <span className="text-muted-foreground">
              {new Date(s.startedAt).toLocaleString()} · {s.testTitle}
            </span>
            <span className="text-muted-foreground">{s.hand === 'left' ? 'L' : 'R'}</span>
            <span className="text-muted-foreground">{s.source}</span>
            <span className="text-muted-foreground">
              {s.summary}
              {s.notes ? ` — ${s.notes}` : ''}
            </span>
          </div>
        ))}
      </div>

      <Disclaimer text={model.disclaimer} />
    </div>
  )
}
