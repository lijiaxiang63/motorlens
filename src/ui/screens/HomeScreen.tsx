// Quick Test home: live preview with skeleton overlay, source/detection
// status, hand selection, test launch cards, and session-JSON import
// (drag-drop onto the preview, file picker, or the sidebar action).

import { FileUp, Users } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { TEST_DEFS } from '../../protocol/definitions'
import type { Hand, LandmarkFrame } from '../../types'
import { Button } from '../components/ui/button'
import { Card, CardDescription, CardFooter, CardTitle } from '../components/ui/card'
import { StatusChip } from '../components/StatusChip'
import { useFrameSubscription, useSourceStatus } from '../hooks/useFrameSubscription'
import { useInterval } from '../hooks/useInterval'
import { importSessionFile } from '../importSession'
import { useNav } from '../nav'
import { PreviewPanel } from '../PreviewPanel'

export function HomeScreen() {
  const { ctx, navigate, source } = useNav()
  const status = useSourceStatus(source)
  const [hand, setHand] = useState<Hand>('right')
  const fileRef = useRef<HTMLInputElement>(null)

  // Frame-rate + last-detection live in refs (30–120 Hz); a 500 ms tick
  // re-renders the chips, matching the vanilla screen's cadence.
  const recvTimes = useRef<number[]>([])
  const lastFrame = useRef<LandmarkFrame | null>(null)
  const [, setChipTick] = useState(0)
  useFrameSubscription(source, (f) => {
    lastFrame.current = f
    const now = performance.now()
    recvTimes.current.push(now)
    while (recvTimes.current.length > 0 && recvTimes.current[0]! < now - 2000) {
      recvTimes.current.shift()
    }
  })
  useInterval(() => setChipTick((n) => n + 1), 500)

  const rt = recvTimes.current
  const fps = rt.length >= 2 ? ((rt.length - 1) / ((rt[rt.length - 1]! - rt[0]!) / 1000)) : 0
  const detected = lastFrame.current?.handedness ?? null

  const sourceLabel =
    source.kind === 'camera'
      ? status.state === 'ready'
        ? 'camera ready'
        : status.state === 'error'
          ? 'camera error'
          : 'loading model…'
      : `${source.kind} source`

  async function importFile(file: File) {
    const err = await importSessionFile(ctx, file)
    if (err) toast.error('Could not import session', { description: err })
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Quick Test</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Run a single assessment without registering a subject — results are not saved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip
            state={status.state === 'ready' ? 'ok' : status.state === 'error' ? 'err' : 'idle'}
          >
            {sourceLabel}
          </StatusChip>
          <StatusChip state={detected ? 'ok' : 'idle'}>
            {detected ? `${detected} hand detected` : 'no hand detected'}
          </StatusChip>
          <StatusChip state={fps >= 15 ? 'ok' : fps > 0 ? 'warn' : 'idle'}>
            <span className="tabular-nums">{fps.toFixed(0)} fps</span>
          </StatusChip>
        </div>
      </header>

      <div className="grid grid-cols-[1.25fr_1fr] items-start gap-5 min-w-0-children max-[900px]:grid-cols-1">
        <div>
          <PreviewPanel onDropFile={(f) => void importFile(f)} className="data-dragging:border-accent">
            <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11.5px] text-white/40">
              Drop a MotorLens session .json here to replay it
            </div>
          </PreviewPanel>

          {status.state === 'error' && (
            <div className="mt-3 rounded-xl border border-danger/45 bg-danger-surface p-3.5 text-sm">
              <strong>Camera unavailable.</strong> {status.message ?? 'Unknown error'}
              <div className="mt-2.5 flex gap-2">
                <Button variant="ghost" onClick={() => location.reload()}>
                  Retry
                </Button>
                <Button variant="ghost" asChild>
                  <a href="?source=synthetic&preset=tap-2hz">Use synthetic demo mode</a>
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Card className="border-accent/30">
            <CardTitle>Subject session</CardTitle>
            <CardDescription>
              Register subjects, run the test battery for each, save videos, and batch-export all
              results.
            </CardDescription>
            <CardFooter>
              <span className="text-xs text-muted-foreground">batch workflow</span>
              <Button variant="primary" onClick={() => navigate({ name: 'subjects' })}>
                <Users /> Open subjects
              </Button>
            </CardFooter>
          </Card>

          <div
            className="flex w-fit overflow-hidden rounded-lg border"
            role="group"
            aria-label="Hand selection"
          >
            {(['left', 'right'] as const).map((hd) => (
              <button
                key={hd}
                type="button"
                onClick={() => setHand(hd)}
                className={
                  hand === hd
                    ? 'cursor-pointer bg-accent px-4 py-1.5 text-[13px] font-semibold text-accent-foreground'
                    : 'cursor-pointer bg-surface px-4 py-1.5 text-[13px] text-muted-foreground hover:text-foreground'
                }
              >
                {hd === 'left' ? 'Left hand' : 'Right hand'}
              </button>
            ))}
          </div>

          {TEST_DEFS.map((def) => (
            <Card key={def.id}>
              <CardTitle>{def.title}</CardTitle>
              <CardDescription>{def.description}</CardDescription>
              <CardFooter>
                <span className="text-xs text-muted-foreground">
                  {def.durationMs / 1000} s · {hand} hand
                </span>
                <Button variant="primary" onClick={() => navigate({ name: 'record', def, hand })}>
                  Start test
                </Button>
              </CardFooter>
            </Card>
          ))}

          <Card>
            <CardTitle>Joint Monitor</CardTitle>
            <CardDescription>
              Live flexion angle, range of motion, and angular velocity for all 15 finger joints.
              Untimed.
            </CardDescription>
            <CardFooter>
              <span className="text-xs text-muted-foreground">live · either hand</span>
              <Button variant="primary" onClick={() => navigate({ name: 'monitor' })}>
                Open monitor
              </Button>
            </CardFooter>
          </Card>

          <div className="text-right">
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <FileUp /> Import session JSON…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void importFile(f)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
