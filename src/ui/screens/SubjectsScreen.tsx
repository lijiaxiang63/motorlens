// Subjects list: registration form, per-subject summary rows, batch export.

import { Archive, Plus, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildBatchExport, downloadBatchExport } from '../../report/batch'
import {
  getVideo,
  listAllResults,
  listSubjects,
  saveSubject,
  type StoredResult,
  type Subject,
} from '../../store/subjects'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { PageHeader } from '../components/PageHeader'
import { StatusChip } from '../components/StatusChip'
import { emptySubject, SubjectForm } from '../components/SubjectForm'
import { useNav } from '../nav'

export function SubjectsScreen() {
  const { navigate } = useNav()
  const [subjects, setSubjects] = useState<Subject[] | null>(null)
  const [results, setResults] = useState<StoredResult[]>([])
  const [storageMb, setStorageMb] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [ss, rs] = await Promise.all([listSubjects(), listAllResults()])
      if (!alive.current) return
      setSubjects(ss)
      setResults(rs)
    } catch (err) {
      if (alive.current) setError(String(err instanceof Error ? err.message : err))
    }
    try {
      const est = await navigator.storage?.estimate?.()
      if (alive.current && est?.usage !== undefined) setStorageMb(est.usage / (1024 * 1024))
    } catch {
      // storage estimate is best-effort
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function exportAll() {
    if (results.length === 0 || subjects === null) return
    setExporting('Preparing…')
    try {
      const entries = subjects
        .map((subject) => ({
          subject,
          results: results.filter((r) => r.subjectId === subject.id),
        }))
        .filter((e) => e.results.length > 0)
      const blob = await buildBatchExport(entries, getVideo, (done, total) => {
        if (alive.current) setExporting(`Preparing… ${done}/${total}`)
      })
      if (!alive.current) return
      // Exposed for automated verification (mirrors window.__lastReport).
      ;(window as unknown as Record<string, unknown>).__lastExport = blob
      await downloadBatchExport(blob)
    } catch (err) {
      if (alive.current) setError(String(err instanceof Error ? err.message : err))
    } finally {
      if (alive.current) setExporting(null)
    }
  }

  const bySubject = new Map<string, StoredResult[]>()
  for (const r of results) {
    const arr = bySubject.get(r.subjectId) ?? []
    arr.push(r)
    bySubject.set(r.subjectId, arr)
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      <PageHeader
        title="Subjects"
        description="Register subjects, run the test battery, export everything at the end."
        actions={
          <>
            {storageMb !== null && (
              <StatusChip state="idle">
                <span className="tabular-nums">
                  {storageMb < 100 ? storageMb.toFixed(1) : storageMb.toFixed(0)} MB stored
                </span>
              </StatusChip>
            )}
            <Button
              variant="primary"
              disabled={results.length === 0 || exporting !== null}
              onClick={() => void exportAll()}
            >
              <Archive /> {exporting ?? 'Export all (ZIP)'}
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <Button variant="primary" onClick={() => setShowForm(true)} disabled={showForm}>
          <Plus /> New subject
        </Button>
      </div>

      {showForm && (
        <SubjectForm
          initial={emptySubject()}
          onSave={async (s) => {
            await saveSubject(s)
            // Straight into the detail screen — fastest path for batch intake.
            navigate({ name: 'subject', subjectId: s.id })
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-danger/45 bg-danger-surface p-3.5 text-sm">
          <strong>Storage error: </strong>
          {error}
        </div>
      )}

      {subjects === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : subjects.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent">
            <UserPlus className="size-6" />
          </div>
          <p className="max-w-[320px] text-[13.5px] text-muted-foreground">
            No subjects yet — register the first one to start a session.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {subjects.map((s) => {
            const rs = bySubject.get(s.id) ?? []
            const videos = new Set(rs.map((r) => r.videoKey).filter(Boolean)).size
            return (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2.5">
                  <strong className="text-[14.5px]">{s.code}</strong>
                  {s.name && <span>{s.name}</span>}
                  {s.diagnosis && <span className="text-muted-foreground">{s.diagnosis}</span>}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {rs.length} result{rs.length === 1 ? '' : 's'}
                  {videos > 0 ? ` · ${videos} video${videos === 1 ? '' : 's'}` : ''}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate({ name: 'subject', subjectId: s.id })}
                >
                  Open
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
