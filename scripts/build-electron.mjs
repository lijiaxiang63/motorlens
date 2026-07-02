// Bundles electron/main.ts + preload.ts to dist-electron/*.cjs with esbuild.
// Kept separate from the Vite renderer build: the renderer targets browsers,
// main/preload target Node + Electron's CJS module system, and Vite 8 has no
// business touching either.
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(projectRoot, 'dist-electron')

await mkdir(outdir, { recursive: true })

await build({
  entryPoints: [join(projectRoot, 'electron/main.ts'), join(projectRoot, 'electron/preload.ts')],
  outdir,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
})

console.log('[motorlens] built electron/{main,preload}.ts -> dist-electron/*.cjs')
