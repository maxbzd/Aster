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

/**
 * Chunks that the first screen needs but that the entry only asks for once it runs (lazy screens, the animation engine):
 * announce them in the page head so the browser fetches them in parallel with the entry instead of one round trip later.
 */
function preloadChunks(names: string[]): Plugin {
  return {
    name: 'aster:preload-chunks',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((file) => names.some((name) => file.startsWith(`assets/${name}-`)) && file.endsWith('.js'))
        return files.map((file) => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: '', href: `./${file}` }, injectTo: 'head' as const }))
      },
    },
  }
}

/** Puts the build's name in the page (`BUILD_TAG`), so that a test can tell two builds of the same code apart. */
function buildTag(): Plugin {
  return {
    name: 'aster:build-tag',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'build', content: process.env.BUILD_TAG ?? '' }, injectTo: 'head' as const }],
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
    buildTag(),
    preloadChunks(['motionFeatures']),
    VitePWA({
      // a new version waits for the person (see src/lib/updates.ts); the page registers the service worker itself
      registerType: 'prompt',
      injectRegister: false,
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
