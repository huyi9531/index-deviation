import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    // Cloudflare 插件必须排在 tanstackStart() 之前
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    viteReact(),
  ],
})
