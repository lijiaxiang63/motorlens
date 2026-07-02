// MediaRecorder wrapper for saving the camera video of a subject-mode test.
// Every failure path is non-fatal: the test result must never be lost because
// video capture is unavailable (unsupported browser, quota, codec…).

import { RECORDER_BITS_PER_SECOND, RECORDER_MIME_CANDIDATES, RECORDER_STOP_TIMEOUT_MS } from '../config'

export interface CapturedVideo {
  blob: Blob
  mimeType: string
}

export interface TestRecorder {
  start(): void
  /** Resolves with the assembled video, or null on failure/timeout. */
  stop(): Promise<CapturedVideo | null>
  /** Abort and discard (test cancelled / screen unmounted). */
  cancel(): void
}

/** Returns null when this browser/source cannot record (caller warns once). */
export function createTestRecorder(video: HTMLVideoElement | null): TestRecorder | null {
  const stream = video?.srcObject
  if (!(stream instanceof MediaStream)) return null
  if (typeof MediaRecorder === 'undefined') return null
  const mimeType = RECORDER_MIME_CANDIDATES.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m)
    } catch {
      return false
    }
  })
  if (!mimeType) return null

  let recorder: MediaRecorder | null = null
  const chunks: Blob[] = []

  return {
    start() {
      try {
        recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: RECORDER_BITS_PER_SECOND,
        })
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data)
        }
        recorder.start(1000)
      } catch (err) {
        console.warn('[motorlens] MediaRecorder start failed', err)
        recorder = null
      }
    },

    stop() {
      const rec = recorder
      recorder = null
      if (!rec || rec.state === 'inactive') return Promise.resolve(null)
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), RECORDER_STOP_TIMEOUT_MS)
        rec.onstop = () => {
          clearTimeout(timer)
          resolve(chunks.length > 0 ? { blob: new Blob(chunks, { type: mimeType }), mimeType } : null)
        }
        try {
          rec.stop()
        } catch {
          clearTimeout(timer)
          resolve(null)
        }
      })
    },

    cancel() {
      const rec = recorder
      recorder = null
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop()
        } catch {
          // discarded anyway
        }
      }
      chunks.length = 0
    },
  }
}
