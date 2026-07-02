// Per-video-frame callbacks with true capture timestamps where supported
// (requestVideoFrameCallback), falling back to a rAF loop that skips
// unchanged frames.

export function startFrameClock(
  video: HTMLVideoElement,
  cb: (mediaTimeMs: number) => void,
): () => void {
  let stopped = false

  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const loop = (_now: DOMHighResTimeStamp, meta: VideoFrameCallbackMetadata) => {
      if (stopped) return
      cb(meta.mediaTime * 1000)
      video.requestVideoFrameCallback(loop)
    }
    video.requestVideoFrameCallback(loop)
    return () => {
      stopped = true
    }
  }

  let lastTime = -1
  const loop = () => {
    if (stopped) return
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime
      cb(lastTime * 1000)
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  return () => {
    stopped = true
  }
}
