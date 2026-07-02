// Thin IndexedDB glue for backup import. The ZIP parsing and merge-planning
// logic lives in report/backup.ts (pure, node-testable); this module only
// snapshots what's already stored and applies a computed ImportPlan — kept
// separate so the pure module never touches a browser API.

import { naturalKey, type ExistingState, type ImportPlan } from '../report/backup'
import { listAllResults, listSubjects, saveResult, saveSubject, saveVideo } from './subjects'

export async function snapshotExistingState(): Promise<ExistingState> {
  const [subjects, results] = await Promise.all([listSubjects(), listAllResults()])
  return {
    subjects: subjects.map((s) => ({ id: s.id, code: s.code })),
    resultIds: new Set(results.map((r) => r.id)),
    resultNaturalKeys: new Set(
      results.map((r) => naturalKey(r.subjectId, r.testId, r.hand, r.startedAt)),
    ),
    videoKeys: new Set(results.flatMap((r) => (r.videoKey ? [r.videoKey] : []))),
  }
}

export interface ImportOutcome {
  subjectsAdded: number
  resultsAdded: number
  videosAdded: number
  skipped: ImportPlan['skipped']
}

/** Apply order matters: subjects → videos → results, so a saved result
 *  never dangles on a missing subject or video. All writes are put-semantics
 *  with caller-supplied ids (planImport already resolved them), so re-running
 *  an import with the same plan is a no-op by construction. */
export async function applyImportPlan(
  plan: ImportPlan,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportOutcome> {
  const total = plan.newSubjects.length + plan.newVideos.length + plan.newResults.length
  let done = 0
  const tick = () => onProgress?.(++done, total)

  for (const s of plan.newSubjects) {
    await saveSubject(s)
    tick()
  }
  for (const v of plan.newVideos) {
    await saveVideo({
      key: v.key,
      blob: new Blob([v.bytes as BlobPart], { type: v.mimeType }),
      mimeType: v.mimeType,
      ...(v.fileName ? { fileName: v.fileName } : {}),
    })
    tick()
  }
  for (const r of plan.newResults) {
    await saveResult(r)
    tick()
  }

  return {
    subjectsAdded: plan.newSubjects.length,
    resultsAdded: plan.newResults.length,
    videosAdded: plan.newVideos.length,
    skipped: plan.skipped,
  }
}
