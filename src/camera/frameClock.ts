// Per-video-frame callbacks. Frame timestamps are wall-clock
// (DOMHighResTimeStamp from the callback itself): video.mediaTime stalls or
// barely advances for getUserMedia streams on some camera stacks, which
// would make all frame-time-driven logic (countdown, test duration,
// velocities) crawl. Wall clock always advances and measures real durations.

export function startFrameClock(
  video: HTMLVideoElement,
  cb: (tMs: number) => void,
): () => void {
  let stopped = false

  // The chain must survive a throwing callback (e.g. a transient MediaPipe
  // GPU error) — otherwise one bad frame silently freezes the whole app.
  const safeCb = (tMs: number) => {
    try {
      cb(tMs)
    } catch (err) {
      console.error('[motorlens] frame callback failed (skipping frame)', err)
    }
  }

  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const loop = (now: DOMHighResTimeStamp, _meta: VideoFrameCallbackMetadata) => {
      if (stopped) return
      safeCb(now)
      video.requestVideoFrameCallback(loop)
    }
    video.requestVideoFrameCallback(loop)
    return () => {
      stopped = true
    }
  }

  // rAF fallback: fire only when the video presents a new frame.
  let lastTime = -1
  const loop = (now: DOMHighResTimeStamp) => {
    if (stopped) return
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime
      safeCb(now)
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  return () => {
    stopped = true
  }
}
