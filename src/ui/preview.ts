// Reusable camera/skeleton preview: shows the source's video (mirrored, if
// any) with the hand skeleton drawn on top. For synthetic/replay sources it
// draws the skeleton on a dark canvas instead.

import { drawHand } from '../tracking/overlay'
import type { FrameSource, LandmarkFrame } from '../types'
import { h } from './components'

export interface PreviewPanel {
  el: HTMLElement
  setFrame(f: LandmarkFrame): void
  destroy(): void
}

export function createPreviewPanel(
  source: FrameSource,
  opts: { highlight?: readonly number[] } = {},
): PreviewPanel {
  let lastFrame: LandmarkFrame | null = null
  let raf = 0

  const overlay = h('canvas', { class: 'preview-overlay' })
  const badgeText =
    source.kind === 'camera' ? null : source.kind === 'replay' ? 'REPLAY' : 'SYNTHETIC'
  const el = h(
    'div',
    { class: 'preview-panel' },
    source.video,
    overlay,
    badgeText ? h('div', { class: 'source-badge' }, badgeText) : null,
  )
  let videoAttached = source.video !== null

  function draw() {
    raf = requestAnimationFrame(draw)
    // The camera's <video> element does not exist until the camera opens —
    // attach it as soon as it appears (else this panel would show only the
    // skeleton forever), and resume it if a DOM move paused it.
    const video = source.video
    if (video) {
      if (!videoAttached) {
        el.prepend(video)
        videoAttached = true
      }
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
    if (lastFrame?.landmarks) {
      drawHand(g, lastFrame.landmarks, w, hgt, {
        mirror: source.kind === 'camera',
        highlight: opts.highlight,
      })
    }
  }
  draw()

  return {
    el,
    setFrame(f) {
      lastFrame = f
    },
    destroy() {
      cancelAnimationFrame(raf)
    },
  }
}
