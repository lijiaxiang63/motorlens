import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5173, strictPort: true },
  // tasks-vision ships a wasm loader that esbuild pre-bundling mangles
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
})
