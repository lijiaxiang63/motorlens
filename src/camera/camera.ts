// getUserMedia wrapper with typed, user-readable failure modes.

export type CameraFailureKind = 'denied' | 'not_found' | 'in_use' | 'unsupported' | 'other'

export class CameraError extends Error {
  constructor(
    public kind: CameraFailureKind,
    message: string,
  ) {
    super(message)
    this.name = 'CameraError'
  }
}

export interface CameraHandle {
  video: HTMLVideoElement
  stream: MediaStream
}

export async function openCamera(): Promise<CameraHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      'unsupported',
      'Camera API unavailable — open the app over localhost or HTTPS.',
    )
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    })
  } catch (err) {
    throw toCameraError(err)
  }
  const video = document.createElement('video')
  video.className = 'preview-video'
  video.playsInline = true
  video.muted = true
  video.srcObject = stream
  await video.play()
  if (video.videoWidth === 0) {
    await new Promise<void>((res) => video.addEventListener('loadedmetadata', () => res(), { once: true }))
  }
  return { video, stream }
}

function toCameraError(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera permission was denied — allow camera access in the browser and retry.')
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('not_found', 'No camera device found.')
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('in_use', 'The camera is in use by another application.')
    default:
      return new CameraError('other', `Could not open the camera: ${String(err)}`)
  }
}
