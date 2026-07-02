// Camera/skeleton preview. Ports ui/preview.ts verbatim inside one effect.
//
// INVARIANT (real-hardware bug, do not simplify): the camera's <video>
// element does not exist until the camera opens, and it is owned by the
// source, NOT by React. It is late-attached by the rAF loop into a dedicated
// host <div> that React renders empty and never reconciles into, and it is
// re-play()ed whenever a DOM move paused it. JSX must never own that element.

import { useEffect, useRef, type ReactNode } from 'react'
import { drawHand } from '../tracking/overlay'
import type { LandmarkFrame } from '../types'
import { cn } from './lib/cn'
import { useFrameSubscription } from './hooks/useFrameSubscription'
import { useSource } from './nav'

export function PreviewPanel({
  highlight,
  className,
  children,
  onDropFile,
}: {
  highlight?: readonly number[]
  className?: string
  children?: ReactNode
  /** Enables drag-drop (session JSON import on the home screen). */
  onDropFile?: (file: File) => void
}) {
  const source = useSource()
  const panelRef = useRef<HTMLDivElement>(null)
  const videoHostRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<LandmarkFrame | null>(null)
  const highlightRef = useRef(highlight)
  highlightRef.current = highlight

  useFrameSubscription(source, (f) => {
    frameRef.current = f
  })

  useEffect(() => {
    const el = panelRef.current!
    const host = videoHostRef.current!
    const overlay = overlayRef.current!
    let raf = 0

    function draw() {
      raf = requestAnimationFrame(draw)
      // Late-attach the source's <video> as soon as it exists (the camera
      // element is created only when the camera opens), and resume it if a
      // DOM move paused it. appendChild also reclaims it from a previous
      // panel's host after screen changes.
      const video = source.video
      if (video) {
        if (video.parentElement !== host) host.appendChild(video)
        if (video.paused) void video.play().catch(() => {})
      }
      const w = el.clientWidth
      const hgt = el.clientHeight
      if (w === 0) return
      const dpr = window.devicePixelRatio || 1
      if (overlay.width !== w * dpr || overlay.height !== hgt * dpr) {
        overlay.width = w * dpr
        overlay.height = hgt * dpr
      }
      const g = overlay.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, hgt)
      const frame = frameRef.current
      if (frame?.landmarks) {
        drawHand(g, frame.landmarks, w, hgt, {
          mirror: source.kind === 'camera',
          highlight: highlightRef.current,
        })
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [source])

  const badge = source.kind === 'camera' ? null : source.kind === 'replay' ? 'REPLAY' : 'SYNTHETIC'

  return (
    <div
      ref={panelRef}
      className={cn(
        'relative aspect-[4/3] overflow-hidden rounded-xl border bg-black',
        className,
      )}
      onDragOver={
        onDropFile
          ? (e) => {
              e.preventDefault()
              e.currentTarget.dataset.dragging = ''
            }
          : undefined
      }
      onDragLeave={onDropFile ? (e) => delete e.currentTarget.dataset.dragging : undefined}
      onDrop={
        onDropFile
          ? (e) => {
              e.preventDefault()
              delete e.currentTarget.dataset.dragging
              const f = e.dataTransfer?.files?.[0]
              if (f) onDropFile(f)
            }
          : undefined
      }
    >
      <div ref={videoHostRef} className="absolute inset-0" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {badge && (
        <div className="absolute left-2.5 top-2.5 rounded-md border border-accent/40 bg-accent/15 px-2 py-0.5 text-[11px] tracking-[1.5px] text-accent">
          {badge}
        </div>
      )}
      {children}
    </div>
  )
}
