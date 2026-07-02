// Camera + HandLandmarker → FrameSource. The video element is exposed for
// the home-screen preview; detection always runs on the raw (unmirrored)
// frames while display mirroring is pure CSS.

import { openCamera, CameraError } from '../camera/camera'
import { startFrameClock } from '../camera/frameClock'
import type { FrameSource, LandmarkFrame, SourceStatus } from '../types'
import { createHandLandmarker } from './handLandmarker'
import { normalizeHandedness } from './landmarks'

export function createCameraSource(): FrameSource {
  let video: HTMLVideoElement | null = null
  let stream: MediaStream | null = null
  let stopClock: (() => void) | null = null
  let landmarker: Awaited<ReturnType<typeof createHandLandmarker>> | null = null
  let lastTs = 0
  let started = false

  const subs = new Set<(f: LandmarkFrame) => void>()
  const statusSubs = new Set<(s: SourceStatus) => void>()
  let status: SourceStatus = { state: 'init' }

  function setStatus(s: SourceStatus) {
    status = s
    for (const cb of statusSubs) cb(s)
  }

  return {
    kind: 'camera',
    get video() {
      return video
    },
    async start() {
      if (started) return
      started = true
      try {
        setStatus({ state: 'init', message: 'Starting camera…' })
        const cam = await openCamera()
        video = cam.video
        stream = cam.stream
        setStatus({ state: 'init', message: 'Loading hand model…' })
        landmarker = await createHandLandmarker()
        setStatus({ state: 'ready' })
      } catch (err) {
        started = false
        setStatus({
          state: 'error',
          message: err instanceof CameraError ? err.message : `Model failed to load: ${String(err)}`,
        })
        return
      }

      stopClock = startFrameClock(video, (mediaTimeMs) => {
        if (!landmarker || !video) return
        // detectForVideo requires strictly increasing integer timestamps.
        const ts = Math.max(lastTs + 1, Math.round(mediaTimeMs))
        lastTs = ts
        const res = landmarker.detectForVideo(video, ts)
        const lm = res.landmarks[0] ?? null
        const cat = res.handedness[0]?.[0]
        const frame: LandmarkFrame = {
          t: ts,
          landmarks: lm,
          world: res.worldLandmarks[0] ?? null,
          handedness: lm ? normalizeHandedness(cat?.categoryName) : null,
          score: lm ? (cat?.score ?? 1) : 0,
          aspect: video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 4 / 3,
        }
        for (const cb of subs) cb(frame)
      })
    },
    stop() {
      stopClock?.()
      stopClock = null
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      landmarker?.close()
      landmarker = null
      started = false
    },
    restart() {
      // Live camera has no notion of restarting playback.
    },
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    onStatus(cb) {
      statusSubs.add(cb)
      cb(status)
      return () => statusSubs.delete(cb)
    },
  }
}
