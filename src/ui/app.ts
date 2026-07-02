// Screen router and shared app context.

import type { TestDefinition } from '../protocol/definitions'
import type { Subject } from '../store/subjects'
import type { CycleAnalysis, FrameSource, Hand, LandmarkFrame, ReportSource } from '../types'
import { createHomeScreen } from './screens/home'
import { createMonitorScreen } from './screens/monitor'
import { createRecordScreen } from './screens/record'
import { createResultsScreen } from './screens/results'
import { createSubjectScreen } from './screens/subject'
import { createSubjectsScreen } from './screens/subjects'
import { createVideoReviewScreen } from './screens/videoReview'

/** Threaded through record → results when a test runs for a registered
 *  subject; its absence keeps the original quick-test flow untouched. */
export interface SubjectTestContext {
  subject: Subject
  saveVideo: boolean
}

export interface ResultProps {
  def: TestDefinition
  hand: Hand
  analysis: CycleAnalysis
  frames: LandmarkFrame[]
  startedAt: string
  /** Video segments differ from def.durationMs; absent = def.durationMs. */
  durationMs?: number
  subject?: Subject
  source?: ReportSource
  capturedVideo?: { blob: Blob; mimeType: string } | null
  videoCaptureFailed?: boolean
  /** Set when viewing an already-stored result — suppresses re-saving. */
  savedResultId?: string
}

export type ScreenRequest =
  | { name: 'home' }
  | { name: 'subjects' }
  | { name: 'subject'; subjectId: string; notice?: string }
  | { name: 'record'; def: TestDefinition; hand: Hand; subjectCtx?: SubjectTestContext }
  | { name: 'results'; result: ResultProps }
  | { name: 'videoReview'; subject: Subject; file: File }
  | { name: 'monitor' }

export interface ScreenInstance {
  el: HTMLElement
  destroy(): void
}

export interface AppContext {
  source: FrameSource
  navigate(req: ScreenRequest): void
  /** Swap in a new source (imported session replay) and return home. */
  replaceSource(s: FrameSource): void
}

export function mountApp(root: HTMLElement, source: FrameSource): AppContext {
  let current: ScreenInstance | null = null

  const ctx: AppContext = {
    source,
    navigate(req) {
      current?.destroy()
      current = createScreen(ctx, req)
      root.replaceChildren(current.el)
      window.scrollTo(0, 0)
    },
    replaceSource(s) {
      ctx.source.stop()
      ctx.source = s
      void s.start()
      ctx.navigate({ name: 'home' })
    },
  }

  ctx.navigate({ name: 'home' })
  return ctx
}

function createScreen(ctx: AppContext, req: ScreenRequest): ScreenInstance {
  switch (req.name) {
    case 'home':
      return createHomeScreen(ctx)
    case 'subjects':
      return createSubjectsScreen(ctx)
    case 'subject':
      return createSubjectScreen(ctx, req.subjectId, req.notice)
    case 'record':
      return createRecordScreen(ctx, req.def, req.hand, req.subjectCtx)
    case 'results':
      return createResultsScreen(ctx, req.result)
    case 'videoReview':
      return createVideoReviewScreen(ctx, req.subject, req.file)
    case 'monitor':
      return createMonitorScreen(ctx)
  }
}
