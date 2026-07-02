import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Mirrors vite.config.ts's define — see src/config.ts's APP_VERSION.
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', import.meta.url)), 'utf8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
