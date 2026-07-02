import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// `npm run dev:lan` sets LAN=1: bind all interfaces and serve HTTPS with the
// self-signed cert from scripts/ensure-cert.mjs (browsers require a secure
// origin for camera access anywhere other than localhost).
const lan = process.env.LAN === '1'
const certDir = fileURLToPath(new URL('.certs/', import.meta.url))
const https =
  lan && existsSync(`${certDir}dev.crt`)
    ? { key: readFileSync(`${certDir}dev.key`), cert: readFileSync(`${certDir}dev.crt`) }
    : undefined

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: lan ? true : 'localhost',
    https,
  },
  // tasks-vision ships a wasm loader that esbuild pre-bundling mangles
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
})
