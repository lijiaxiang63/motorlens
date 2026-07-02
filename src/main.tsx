import '@fontsource-variable/inter/index.css'
import './ui/tokens.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getPreset } from './replay/presets'
import { createReplaySource } from './replay/replaySource'
import type { FrameSource } from './types'
import { App } from './ui/root'

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
  void source.start()
  // window.__ctx (the headless-verification handle) is assigned inside
  // NavProvider once the router exists.
  createRoot(root).render(
    <StrictMode>
      <App source={source} />
    </StrictMode>,
  )
})
