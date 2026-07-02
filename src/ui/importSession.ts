// Session-JSON import, shared by the home screen (drop / picker) and the
// sidebar Import action. Cycle-test sessions recompute their metrics from the
// raw frames (deterministic — the regression harness); joint-monitor sessions
// replay as a live source instead.

import { testDefById } from '../protocol/definitions'
import { createReplaySource } from '../replay/replaySource'
import { parseSessionJson } from '../report/export'
import type { AppContext } from './nav'

/** Returns null on success, or a user-facing error message. */
export async function importSessionFile(ctx: AppContext, file: File): Promise<string | null> {
  try {
    const report = parseSessionJson(await file.text())
    const def = testDefById(report.test)
    if (def) {
      ctx.navigate({
        name: 'results',
        result: {
          def,
          hand: report.hand,
          analysis: def.compute(report.raw.frames),
          frames: report.raw.frames,
          startedAt: report.startedAt,
          ...(report.notes ? { notes: report.notes } : {}),
        },
      })
      return null
    }
    ctx.replaceSource(createReplaySource(report.raw.frames, { kind: 'replay', loop: true }))
    return null
  } catch (err) {
    return String(err instanceof Error ? err.message : err)
  }
}
