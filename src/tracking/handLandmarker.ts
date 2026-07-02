// MediaPipe HandLandmarker initialization with local-asset → CDN fallback
// and GPU → CPU delegate fallback.

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import {
  CDN_MODEL_URL,
  CDN_WASM_BASE,
  LOCAL_MODEL_URL,
  LOCAL_WASM_BASE,
} from '../config'

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const [wasmLocal, modelLocal] = await Promise.all([
    headOk(`${LOCAL_WASM_BASE}/vision_wasm_internal.wasm`),
    headOk(LOCAL_MODEL_URL),
  ])
  const wasmBase = wasmLocal ? LOCAL_WASM_BASE : CDN_WASM_BASE
  const modelAssetPath = modelLocal ? LOCAL_MODEL_URL : CDN_MODEL_URL
  if (!wasmLocal || !modelLocal) {
    console.warn('[motorlens] local MediaPipe assets missing, falling back to CDN', {
      wasmBase,
      modelAssetPath,
    })
  }

  const fileset = await FilesetResolver.forVisionTasks(wasmBase)
  const options = (delegate: 'GPU' | 'CPU') =>
    ({
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }) as const

  try {
    return await HandLandmarker.createFromOptions(fileset, options('GPU'))
  } catch (err) {
    console.warn('[motorlens] GPU delegate failed, retrying with CPU', err)
    return await HandLandmarker.createFromOptions(fileset, options('CPU'))
  }
}
