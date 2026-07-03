// Typed state router. ScreenRequest payloads carry live objects —
// TestDefinition (functions), File, Blob, LandmarkFrame[] — so nothing here
// serializes; navigation is an in-memory request stack, not URLs.
//
// The harness contract from the vanilla app is preserved verbatim:
// window.__ctx = { source, navigate, replaceSource } with a *stable* object
// identity and a mutable `source` property (assigned once on mount).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { MetricKey } from '../analysis/metricCatalog'
import type { CycleTestDefinition, TestDefinition } from '../protocol/definitions'
import type { Subject } from '../store/subjects'
import type { CycleAnalysis, FrameSource, Hand, LandmarkFrame, ReportSource, TestId } from '../types'

/** Threaded through record → results when a test runs for a registered
 *  subject; its absence keeps the original quick-test flow untouched. */
export interface SubjectTestContext {
  subject: Subject
  saveVideo: boolean
}

/** Family-agnostic result payload fields. `ResultProps` correlates these
 *  with a matching def/analysis pair per test family — build instances via
 *  buildResultProps (ui/resultProps.ts), never by hand-pairing. */
export interface ResultCommon {
  hand: Hand
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
  /** Seeds the notes editor when reopening a stored/imported result. */
  notes?: string
}

export type ResultProps = ResultCommon & { def: CycleTestDefinition; analysis: CycleAnalysis }

export type ScreenRequest =
  | { name: 'home' }
  | { name: 'subjects' }
  | { name: 'subject'; subjectId: string; notice?: string }
  | { name: 'record'; def: TestDefinition; hand: Hand; subjectCtx?: SubjectTestContext }
  | { name: 'results'; result: ResultProps }
  | { name: 'videoReview'; subject: Subject; file: File }
  | { name: 'monitor' }
  | { name: 'settings' }
  | { name: 'trend'; subjectId: string; testId: TestId; metricKey: MetricKey; hand?: Hand }
  | { name: 'compare'; subjectId: string; aId: string; bId: string }
  | { name: 'report'; kind: 'session'; resultId: string }
  | { name: 'report'; kind: 'subject'; subjectId: string }

/** Legacy screen-factory contract (kept while vanilla screens are wrapped). */
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

interface NavState {
  source: FrameSource
  screen: ScreenRequest
  /** Monotonic per navigation — used as a React key so every navigate
   *  remounts the screen (matches the vanilla destroy/recreate semantics). */
  navCount: number
  ctx: AppContext
  navigate(req: ScreenRequest): void
  back(): void
}

const NavContext = createContext<NavState | null>(null)

/** Sidebar destinations reset the stack; everything else pushes. */
const TOP_LEVEL: ReadonlySet<ScreenRequest['name']> = new Set([
  'home',
  'subjects',
  'monitor',
  'settings',
])

export function NavProvider({
  initialSource,
  children,
}: {
  initialSource: FrameSource
  children: ReactNode
}) {
  const [source, setSource] = useState(initialSource)
  const [stack, setStack] = useState<ScreenRequest[]>([{ name: 'home' }])
  const [navCount, setNavCount] = useState(0)

  const navigate = useCallback((req: ScreenRequest) => {
    setStack((prev) => (TOP_LEVEL.has(req.name) ? [req] : [...prev, req]))
    setNavCount((n) => n + 1)
  }, [])

  const back = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : [{ name: 'home' }]))
    setNavCount((n) => n + 1)
  }, [])

  // Stable AppContext identity for the harness and for legacy screens.
  // `source` is a mutable property, exactly like the vanilla router's ctx.
  const ctxRef = useRef<AppContext | null>(null)
  const sourceRef = useRef(initialSource)
  if (ctxRef.current === null) {
    ctxRef.current = {
      source: initialSource,
      navigate,
      replaceSource(s: FrameSource) {
        sourceRef.current.stop()
        sourceRef.current = s
        ctxRef.current!.source = s
        void s.start()
        setSource(s)
        navigate({ name: 'home' })
      },
    }
  }

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__ctx = ctxRef.current
  }, [])

  const screen = stack[stack.length - 1] ?? { name: 'home' as const }
  const value = useMemo<NavState>(
    () => ({ source, screen, navCount, ctx: ctxRef.current!, navigate, back }),
    [source, screen, navCount, navigate, back],
  )
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNav(): NavState {
  const v = useContext(NavContext)
  if (!v) throw new Error('useNav outside NavProvider')
  return v
}

/** The live frame source (re-renders consumers when replaceSource swaps it). */
export function useSource(): FrameSource {
  return useNav().source
}
