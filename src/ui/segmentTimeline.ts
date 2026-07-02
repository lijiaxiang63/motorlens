// Canvas timeline for the video-review screen: detection coverage, colored
// segment blocks (blue = tap, green = fist), playhead, click to seek/select.

import { SEG_CONFIDENCE_WARN } from '../config'
import type { Hand } from '../types'
import { h } from './components'

export interface EditableSegment {
  startMs: number
  endMs: number
  hand: Hand
  testId: 'finger_tap' | 'fist_open_close'
  confidence: number
}

export interface SegmentTimelineOpts {
  durationMs: number
  /** Detected-frame samples (t + which hand), for the coverage band. */
  coverage: { t: number; hand: Hand | null }[]
  getSegments(): EditableSegment[]
  getSelected(): number
  getPlayheadMs(): number
  onSeek(ms: number): void
  onSelect(index: number): void
}

export interface SegmentTimeline {
  el: HTMLElement
  refresh(): void
  destroy(): void
}

const HEIGHT = 64

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'
}

export function createSegmentTimeline(opts: SegmentTimelineOpts): SegmentTimeline {
  const canvas = h('canvas', { class: 'segment-timeline' })
  const el = h('div', { class: 'timeline-panel' }, canvas)
  const g = canvas.getContext('2d')!
  let raf = 0
  let width = 0

  const colors = {
    track: cssVar('--panel-2'),
    border: cssVar('--border'),
    coverage: cssVar('--muted'),
    tap: cssVar('--accent'),
    fist: cssVar('--ok'),
    warn: cssVar('--warn'),
    text: cssVar('--text'),
  }

  const xOf = (ms: number) => (ms / opts.durationMs) * width
  const msOf = (x: number) => (x / width) * opts.durationMs

  function draw() {
    if (width <= 0) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(HEIGHT * dpr)
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, HEIGHT)

    // Track + coverage band (where any hand was detected).
    g.fillStyle = colors.track
    g.fillRect(0, 0, width, HEIGHT)
    g.fillStyle = colors.coverage
    g.globalAlpha = 0.45
    for (const c of opts.coverage) {
      if (c.hand !== null) g.fillRect(xOf(c.t), HEIGHT - 10, Math.max(width / opts.coverage.length, 1), 6)
    }
    g.globalAlpha = 1

    // Segment blocks.
    const segments = opts.getSegments()
    const selected = opts.getSelected()
    segments.forEach((s, i) => {
      const x = xOf(s.startMs)
      const w = Math.max(xOf(s.endMs) - x, 2)
      const color = s.testId === 'finger_tap' ? colors.tap : colors.fist
      g.globalAlpha = i === selected ? 0.5 : 0.28
      g.fillStyle = color
      g.fillRect(x, 6, w, HEIGHT - 22)
      g.globalAlpha = 1
      g.lineWidth = i === selected ? 2.5 : 1.25
      g.strokeStyle = s.confidence < SEG_CONFIDENCE_WARN ? colors.warn : color
      g.strokeRect(x, 6, w, HEIGHT - 22)
      g.fillStyle = colors.text
      g.font = '600 11px system-ui, sans-serif'
      g.fillText(`${s.hand === 'left' ? 'L' : 'R'} ${s.testId === 'finger_tap' ? 'tap' : 'fist'}`, x + 5, 20)
    })

    // Playhead.
    const px = xOf(Math.min(opts.getPlayheadMs(), opts.durationMs))
    g.strokeStyle = colors.text
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(px, 0)
    g.lineTo(px, HEIGHT)
    g.stroke()
  }

  function loop() {
    draw()
    raf = requestAnimationFrame(loop)
  }

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect()
    const ms = msOf(e.clientX - rect.left)
    const segments = opts.getSegments()
    const hit = segments.findIndex((s) => ms >= s.startMs && ms <= s.endMs)
    if (hit !== -1) opts.onSelect(hit)
    opts.onSeek(ms)
  })

  // Match the mounted width; only react to real width changes (see
  // liveChart.ts for why observing padded parents needs care).
  const ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width ?? 0
    if (w > 0 && Math.abs(w - width) > 1) {
      width = w
      draw()
    }
  })
  ro.observe(el)
  raf = requestAnimationFrame(loop)

  return {
    el,
    refresh: draw,
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
    },
  }
}
