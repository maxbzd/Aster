import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Отдельный конфиг: без PWA-плагина и Tailwind, чтобы тесты стартовали мгновенно.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), 'virtual:pwa-register': fileURLToPath(new URL('./tests/stubs/pwa-register.ts', import.meta.url)) } },
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
      // the eval harness and its screen are developer tools that call real models: they are run by hand (npm run eval)
      exclude: ['src/main.tsx', 'src/data/demo/**', 'src/**/*.d.ts', 'src/ai/eval/**', 'src/screens/Eval.tsx'],
      reporter: ['text-summary', 'html', 'json-summary'],
      // a floor, not a goal: coverage may only go up (measured 84.4 / 75.4 / 77.7 / 88.2 on 4 Nov 2026)
      thresholds: { statements: 84, branches: 75, functions: 77, lines: 88 },
    },
  },
})
