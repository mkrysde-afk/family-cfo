import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Только для локальной разработки: отдаёт начальные данные из папки private/
// по адресу /__dev-seed.json. В production-сборку эти данные НЕ попадают.
function devSeed(): Plugin {
  return {
    name: 'dev-seed',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev-seed.json', (_req, res) => {
        const file = path.resolve(process.cwd(), 'private/family-cfo-start.json')
        if (!fs.existsSync(file)) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(fs.readFileSync(file))
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), devSeed()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
