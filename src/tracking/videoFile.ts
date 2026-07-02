// Offline MediaPipe over an uploaded video file. Seek-stepping (not
// playback) so processing is deterministic, never drops frames, and works in
// background tabs; a file's mediaTime is reliable — unlike getUserMedia
// streams (see camera/frameClock.ts) — and IS the player-timeline coordinate
// the review screen needs, so frames carry currentTime-based timestamps.
//
// Creates its OWN HandLandmarker: detectForVideo timestamps are monotonic per
// instance, so a concurrently running camera source is unaffected.

import { VIDEO_PROC_FPS, VIDEO_SEEK_TIMEOUT_MS } from '../config'
import type { LandmarkFrame } from '../types'
import { createHandLandmarker } from './handLandmarker'
import { normalizeHandedness } from './landmarks'

export interface ProcessedVideo {
  frames: LandmarkFrame[]
  durationMs: number
  width: number
  height: number
}

function once(video: HTMLVideoElement, event: string, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for video ${what} — the file may use an unsupported codec`))
    }, timeoutMs)
    const onEvent = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Unsupported or corrupt video file'))
    }
    function cleanup() {
      clearTimeout(timer)
      video.removeEventListener(event, onEvent)
      video.removeEventListener('error', onError)
    }
    video.addEventListener(event, onEvent)
    video.addEventListener('error', onError)
  })
}

/** Resolve the real duration. MediaRecorder-produced webm (including
 *  MotorLens's own captures) reports Infinity until forced to the end. */
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration)) return video.duration
  const changed = once(video, 'durationchange', VIDEO_SEEK_TIMEOUT_MS, 'duration')
  video.currentTime = 1e10
  await changed
  const d = video.duration
  if (!Number.isFinite(d)) throw new Error('Could not determine video duration')
  return d
}

export async function processVideoFile(
  file: File,
  onProgress: (fraction: number, tMs: number) => void,
  signal?: AbortSignal,
): Promise<ProcessedVideo> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Video processing cancelled', 'AbortError')
  }

  let landmarker: Awaited<ReturnType<typeof createHandLandmarker>> | null = null
  try {
    const metadata = once(video, 'loadedmetadata', VIDEO_SEEK_TIMEOUT_MS * 2, 'metadata')
    video.src = url
    await metadata
    const duration = await resolveDuration(video)
    throwIfAborted()

    landmarker = await createHandLandmarker()
    throwIfAborted()

    const seekTo = async (t: number) => {
      const seeked = once(video, 'seeked', VIDEO_SEEK_TIMEOUT_MS, 'seek')
      // Nudge t=0 so the very first assignment is a real position change and
      // reliably fires 'seeked' on every browser.
      video.currentTime = Math.max(t, 0.0001)
      await seeked
    }

    const frames: LandmarkFrame[] = []
    const step = 1 / VIDEO_PROC_FPS
    let lastTs = 0
    for (let t = 0; t < duration; t += step) {
      throwIfAborted()
      await seekTo(Math.min(t, duration))
      const tMs = video.currentTime * 1000
      const ts = Math.max(lastTs + 1, Math.round(tMs))
      lastTs = ts
      let res: ReturnType<NonNullable<typeof landmarker>['detectForVideo']> | null = null
      try {
        res = landmarker.detectForVideo(video, ts)
      } catch {
        // Same policy as the camera source: a failed detect is a blank frame.
      }
      const lm = res?.landmarks[0] ?? null
      const cat = res?.handedness[0]?.[0]
      frames.push({
        t: tMs,
        landmarks: lm,
        world: res?.worldLandmarks[0] ?? null,
        handedness: lm ? normalizeHandedness(cat?.categoryName) : null,
        score: lm ? (cat?.score ?? 1) : 0,
        aspect: video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 16 / 9,
      })
      onProgress(Math.min(t / duration, 1), tMs)
    }

    return {
      frames,
      durationMs: duration * 1000,
      width: video.videoWidth,
      height: video.videoHeight,
    }
  } finally {
    landmarker?.close()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}
