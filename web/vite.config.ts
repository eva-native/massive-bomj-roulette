/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Go server listens on :8080; the dev server proxies API and auth to it.
const backend = process.env.MBR_BACKEND ?? 'http://localhost:8080'

// The git ref the rules link points to: MBR_VERSION if given (Docker builds
// have no .git), else the release tag of this commit, else the commit itself.
function rulesRef(): string {
  if (process.env.MBR_VERSION) return process.env.MBR_VERSION
  for (const cmd of ['git describe --tags --exact-match', 'git rev-parse HEAD']) {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      // not a tagged commit, or no git: try the next one
    }
  }
  return 'main'
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_RULES_REF': JSON.stringify(rulesRef()),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': backend,
      '/auth': backend,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/polyfills.ts', './src/test/setup.ts'],
  },
})
