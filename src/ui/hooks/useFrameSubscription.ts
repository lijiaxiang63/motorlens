import { useEffect, useRef, useState } from 'react'
import type { FrameSource, LandmarkFrame, SourceStatus } from '../../types'

/** Subscribe to a FrameSource for the lifetime of the component. The callback
 *  lives in a ref so subscription identity is stable across renders; frames
 *  never flow through React state (30–120 Hz). StrictMode-safe: the effect
 *  cleanly unsubscribes between double-invocations. */
export function useFrameSubscription(
  source: FrameSource,
  cb: (f: LandmarkFrame) => void,
): void {
  const cbRef = useRef(cb)
  useEffect(() => {
    cbRef.current = cb
  })
  useEffect(() => source.subscribe((f) => cbRef.current(f)), [source])
}

/** Current source status (init/ready/error) as React state. */
export function useSourceStatus(source: FrameSource): SourceStatus {
  const [status, setStatus] = useState<SourceStatus>({ state: 'init' })
  useEffect(() => source.onStatus(setStatus), [source])
  return status
}
