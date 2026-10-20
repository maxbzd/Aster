import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Отдельный конфиг: без PWA-плагина и Tailwind, чтобы тесты стартовали мгновенно.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'happy-dom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    env: { TZ: 'Europe/Moscow', VITE_SUPABASE_URL: 'https://test-project.supabase.co', VITE_SUPABASE_KEY: 'sb_publishable_test' },
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'api/**/*.ts'],
      exclude: ['src/main.tsx', 'src/data/demo/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
    },
  },
})
