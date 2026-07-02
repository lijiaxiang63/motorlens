// Populates public/mediapipe/ with the wasm runtime (copied from node_modules)
// and the hand landmarker model (downloaded from Google's model storage).
// Never fails the install: on download failure the app falls back to CDN URLs
// at runtime (see src/config.ts).
import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasmSrc = join(projectRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const outDir = join(projectRoot, 'public', 'mediapipe')
const wasmOut = join(outDir, 'wasm')
const modelOut = join(outDir, 'hand_landmarker.task')

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

await mkdir(wasmOut, { recursive: true })

if (await exists(wasmSrc)) {
  await cp(wasmSrc, wasmOut, { recursive: true })
  console.log('[motorlens] copied MediaPipe wasm runtime -> public/mediapipe/wasm')
} else {
  console.warn('[motorlens] WARNING: node_modules wasm dir not found; run `npm install` first')
}

if (await exists(modelOut)) {
  console.log('[motorlens] hand_landmarker.task already present, skipping download')
} else {
  try {
    const res = await fetch(MODEL_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(modelOut, buf)
    console.log(`[motorlens] downloaded hand_landmarker.task (${(buf.length / 1e6).toFixed(1)} MB)`)
  } catch (err) {
    console.warn(
      '\n[motorlens] WARNING: could not download the hand landmarker model.\n' +
        `  ${err}\n` +
        '  The app will fall back to loading it from the network at runtime.\n' +
        '  To work fully offline, download it manually:\n' +
        `    curl -L -o public/mediapipe/hand_landmarker.task '${MODEL_URL}'\n`,
    )
  }
}
