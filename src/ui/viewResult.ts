// Recompute-from-raw-frames navigation to the results screen for an
// already-stored result — the same regression-harness path the JSON import
// uses. Shared by SubjectScreen's "View" action and the trend/compare
// screens' click-through into a stored session.

import { testDefById } from '../protocol/definitions'
import type { StoredResult, Subject } from '../store/subjects'
import type { ScreenRequest } from './nav'

/** Returns false (no navigation) when the result's testId has no
 *  TestDefinition — e.g. a joint_monitor row, which has no results screen. */
export function viewStoredResult(
  navigate: (req: ScreenRequest) => void,
  subject: Subject,
  r: StoredResult,
): boolean {
  const def = testDefById(r.testId)
  if (!def) return false
  const frames = r.report.raw.frames
  navigate({
    name: 'results',
    result: {
      def,
      hand: r.hand,
      analysis: def.compute(frames),
      frames,
      startedAt: r.startedAt,
      durationMs: r.report.durationMs,
      subject,
      ...(r.report.source ? { source: r.report.source } : {}),
      ...(r.report.notes ? { notes: r.report.notes } : {}),
      savedResultId: r.id,
    },
  })
  return true
}
