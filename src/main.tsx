import '@fontsource-variable/inter/index.css'
import './ui/tokens.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getPreset } from './replay/presets'
import { createReplaySource } from './replay/replaySource'
import type { FrameSource } from './types'
import { ReportView } from './ui/report/ReportView'
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

// Electron's hidden print window (electron/pdf.ts) loads this same bundle
// with `?report=session|subject&id=<id>` — render just the report document,
// with no FrameSource/camera, no NavProvider, no Shell. Checked before
// createSource() so getUserMedia/MediaPipe can never load in that window.
const reportKind = params.get('report')
if (reportKind === 'session' || reportKind === 'subject') {
  createRoot(root).render(
    <StrictMode>
      <ReportView kind={reportKind} id={params.get('id') ?? ''} />
    </StrictMode>,
  )
} else {
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
}
