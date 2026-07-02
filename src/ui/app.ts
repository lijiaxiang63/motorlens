// Screen router and shared app context.

import type { TestDefinition } from '../protocol/definitions'
import type { CycleAnalysis, FrameSource, Hand, LandmarkFrame } from '../types'
import { createHomeScreen } from './screens/home'
import { createMonitorScreen } from './screens/monitor'
import { createRecordScreen } from './screens/record'
import { createResultsScreen } from './screens/results'

export interface ResultProps {
  def: TestDefinition
  hand: Hand
  analysis: CycleAnalysis
  frames: LandmarkFrame[]
  startedAt: string
}

export type ScreenRequest =
  | { name: 'home' }
  | { name: 'record'; def: TestDefinition; hand: Hand }
  | { name: 'results'; result: ResultProps }
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
    case 'record':
      return createRecordScreen(ctx, req.def, req.hand)
    case 'results':
      return createResultsScreen(ctx, req.result)
    case 'monitor':
      return createMonitorScreen(ctx)
  }
}
