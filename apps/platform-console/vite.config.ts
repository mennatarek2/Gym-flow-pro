/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const apiTarget = env.VITE_API_PROXY_TARGET || 'https://reach-lullaby-tighten.ngrok-free.dev'

  return {
    plugins: [react(), tailwindcss()] as any,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5174,
      proxy: {
        '/platform-api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
          headers: { 'ngrok-skip-browser-warning': 'true' },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
