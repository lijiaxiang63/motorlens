// Runs Electron against the normal `vite` dev server (no separate renderer
// build path — dev-Electron and `npm run dev` serve byte-identical code).
// Rebuilds electron/{main,preload}.ts on change and restarts Electron.
import { spawn } from 'node:child_process'
import { context } from 'esbuild'
import electronPath from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const RENDERER_URL = 'http://localhost:5173/'

async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Vite dev server did not become ready at ${url}`)
}

const vite = spawn('npx', ['vite'], { cwd: projectRoot, stdio: 'inherit', shell: true })

let electronProc = null
function startElectron() {
  electronProc?.removeAllListeners('exit')
  electronProc?.kill()
  electronProc = spawn(electronPath, [join(projectRoot, 'dist-electron', 'main.cjs')], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RENDERER_URL: RENDERER_URL },
  })
  electronProc.on('exit', (code) => {
    // Electron window closed by the user — tear the whole dev session down.
    shutdown(code ?? 0)
  })
}

const ctx = await context({
  entryPoints: [join(projectRoot, 'electron/main.ts'), join(projectRoot, 'electron/preload.ts')],
  outdir: join(projectRoot, 'dist-electron'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'restart-electron',
      setup(build) {
        let first = true
        build.onEnd((result) => {
          if (result.errors.length > 0) return
          if (first) {
            first = false
            return
          }
          console.log('[motorlens] electron/{main,preload} rebuilt — restarting Electron')
          startElectron()
        })
      },
    },
  ],
})

function shutdown(code) {
  ctx.dispose()
  vite.kill()
  electronProc?.removeAllListeners('exit')
  electronProc?.kill()
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

await ctx.rebuild()
await waitForServer(RENDERER_URL)
startElectron()
await ctx.watch()
