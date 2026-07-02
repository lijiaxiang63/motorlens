import './style.css'
import { getPreset } from './replay/presets'
import { createReplaySource } from './replay/replaySource'
import type { FrameSource } from './types'
import { mountApp } from './ui/app'

const params = new URLSearchParams(location.search)

async function createSource(): Promise<FrameSource> {
  if (params.get('source') === 'synthetic') {
    const preset = getPreset(params.get('preset') ?? 'tap-2hz')
    const speed = Number(params.get('speed') ?? '1')
    return createReplaySource(preset.frames, {
      kind: 'synthetic',
      speed: Number.isFinite(speed) && speed > 0 ? speed : 1,
      loop: true,
    })
  }
  // Lazy import so synthetic/replay mode never loads MediaPipe.
  const { createCameraSource } = await import('./tracking/cameraSource')
  return createCameraSource()
}

const root = document.getElementById('app')!
void createSource().then((source) => {
  const ctx = mountApp(root, source)
  void source.start()
  // Debug/automation handle (used by the headless verification flow).
  ;(window as unknown as Record<string, unknown>).__ctx = ctx
})
