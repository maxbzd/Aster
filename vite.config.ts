import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'

/**
 * GitHub Pages cannot send headers, so `public/_headers` (used by Cloudflare and Netlify) does nothing there, and the
 * hosted app would run with no content policy at all. This copies the policy from that single source into a <meta> tag
 * of the built index.html. Browsers ignore `frame-ancestors` in a <meta>, and `upgrade-insecure-requests` would break
 * `vite preview` on http://127.0.0.1, so both are left to the real header.
 */
function cspMeta(): Plugin {
  return {
    name: 'aster:csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const headers = readFileSync(fileURLToPath(new URL('./public/_headers', import.meta.url)), 'utf8')
      const line = headers.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:'))
      if (!line) throw new Error('public/_headers has no Content-Security-Policy line')
      const policy = line
        .slice(line.indexOf(':') + 1)
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !/^(frame-ancestors|upgrade-insecure-requests)\b/.test(d))
        .join('; ')
      const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${tag}`)
    },
  }
}

export default defineConfig({
  // Relative paths: the build works from the root of a domain (Cloudflare) and from a sub-path (GitHub Pages).
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        // large libraries go to separate chunks: they stay cached across app updates
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          if (/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(id)) return 'motion'
          if (/node_modules\/(dexie|dexie-react-hooks)\//.test(id)) return 'db'
          if (/node_modules\/react-router/.test(id)) return 'router'
        },
      },
    },
  },
  server: { port: 5191, strictPort: true, host: '127.0.0.1' },
  preview: { port: 5192, strictPort: true, host: '127.0.0.1' },
  plugins: [
    react(),
    tailwindcss(),
    cspMeta(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Aster: your network',
        short_name: 'Aster',
        description: 'A personal CRM for networking: people, meetings, connections and reminders.',
        lang: 'en',
        theme_color: '#05060a',
        background_color: '#05060a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        share_target: { action: './', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
})
