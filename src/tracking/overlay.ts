// Hand skeleton drawing. Connection list matches MediaPipe's
// HAND_CONNECTIONS (hardcoded so drawing works without loading tasks-vision).

import type { Vec3 } from '../types'

const CONNECTIONS: readonly [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
]

export interface OverlayOptions {
  /** Mirror horizontally to match a selfie-view video. */
  mirror?: boolean
  /** Landmark indices to emphasize (e.g. the tapping fingertips). */
  highlight?: readonly number[]
}

export function drawHand(
  ctx: CanvasRenderingContext2D,
  landmarks: Vec3[],
  width: number,
  height: number,
  opts: OverlayOptions = {},
): void {
  ctx.save()
  if (opts.mirror) {
    ctx.translate(width, 0)
    ctx.scale(-1, 1)
  }
  ctx.lineWidth = Math.max(2, width / 320)
  ctx.strokeStyle = 'rgba(77, 163, 255, 0.9)'
  ctx.lineCap = 'round'
  for (const [a, b] of CONNECTIONS) {
    const pa = landmarks[a]!
    const pb = landmarks[b]!
    ctx.beginPath()
    ctx.moveTo(pa.x * width, pa.y * height)
    ctx.lineTo(pb.x * width, pb.y * height)
    ctx.stroke()
  }
  const highlight = new Set(opts.highlight ?? [])
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i]!
    ctx.beginPath()
    ctx.arc(p.x * width, p.y * height, highlight.has(i) ? 7 : 3.5, 0, 2 * Math.PI)
    ctx.fillStyle = highlight.has(i) ? 'rgba(255, 209, 102, 0.95)' : 'rgba(232, 236, 244, 0.9)'
    ctx.fill()
  }
  ctx.restore()
}
