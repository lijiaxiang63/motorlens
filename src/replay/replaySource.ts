// FrameSource that plays back a frame array on its recorded timestamps.
// Used for synthetic presets and for re-analyzing exported sessions.
// `speed` compresses wall-clock playback but leaves frame timestamps
// untouched, so all frame-time-driven logic behaves identically.

import type { FrameSource, LandmarkFrame, SourceStatus } from '../types'

export interface ReplayOptions {
  kind?: 'synthetic' | 'replay'
  speed?: number
  loop?: boolean
  /** Time gap inserted at loop/restart boundaries; larger than MAX_GAP_MS so
   *  analyses split segments there instead of seeing a phantom movement. */
  loopGapMs?: number
}

export function createReplaySource(
  frames: LandmarkFrame[],
  opts: ReplayOptions = {},
): FrameSource {
  const speed = Math.max(opts.speed ?? 1, 0.1)
  const loop = opts.loop ?? true
  const gap = opts.loopGapMs ?? 400
  const t0 = frames[0]?.t ?? 0
  const norm = frames.map((f) => ({ ...f, t: f.t - t0 }))
  const span = (norm[norm.length - 1]?.t ?? 0) + gap

  let idx = 0
  let epoch = 0
  let playing = false
  let timer: ReturnType<typeof setTimeout> | null = null
  // Wall-clock anchor for the playback position. Emission catches up to
  // "now" on every tick, so throttled timers (hidden tabs) batch frames
  // instead of stalling playback.
  let anchorWall = 0
  let anchorT = 0
  const subs = new Set<(f: LandmarkFrame) => void>()
  const statusSubs = new Set<(s: SourceStatus) => void>()
  let status: SourceStatus = { state: 'init' }

  const MAX_BATCH = 2000

  function setStatus(s: SourceStatus) {
    status = s
    for (const cb of statusSubs) cb(s)
  }

  function frameT(i: number, ep: number): number {
    return norm[i]!.t + ep * span
  }

  function rewindTo(i: number, ep: number) {
    idx = i
    epoch = ep
    anchorWall = performance.now()
    anchorT = frameT(i, ep)
  }

  function tick() {
    if (!playing || norm.length === 0) return
    const nowT = anchorT + (performance.now() - anchorWall) * speed
    let emitted = 0
    while (emitted < MAX_BATCH && frameT(idx, epoch) <= nowT) {
      const f = norm[idx]!
      const t = frameT(idx, epoch)
      for (const cb of subs) cb({ ...f, t })
      emitted++
      idx++
      if (idx >= norm.length) {
        if (!loop) {
          playing = false
          return
        }
        idx = 0
        epoch++
      }
    }
    timer = setTimeout(tick, Math.max((frameT(idx, epoch) - nowT) / speed, 0))
  }

  return {
    kind: opts.kind ?? 'synthetic',
    video: null,
    async start() {
      if (playing || norm.length === 0) {
        setStatus(norm.length === 0 ? { state: 'error', message: 'Empty recording' } : status)
        return
      }
      playing = true
      setStatus({ state: 'ready' })
      rewindTo(0, 0)
      tick()
    },
    stop() {
      playing = false
      if (timer) clearTimeout(timer)
    },
    restart() {
      // Jump to the start of the pattern while keeping time monotonic.
      if (timer) clearTimeout(timer)
      rewindTo(0, epoch + 1)
      if (playing) tick()
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
