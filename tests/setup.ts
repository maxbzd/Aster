import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import { afterEach } from 'vitest'
import { registerDictionary, setLocale, type Dictionary } from '@/i18n'
import ru from '@/i18n/locales/ru.json'

// The suite asserts the Russian UI (the original language of the app); English is covered by tests that call `setLocale('en')`.
registerDictionary('ru', ru as Dictionary)
setLocale('ru')

// Часть тестов (серверный прокси) идёт в окружении node — браузерных заглушек там нет и они не нужны.
if (typeof window !== 'undefined') {
  afterEach(() => cleanup())
  // без гигантского дампа DOM в сообщениях об ошибках — читать отчёт можно глазами
  // ленивые экраны и шторки при параллельном прогоне грузятся дольше секунды: ждём до 5 с
  configure({ asyncUtilTimeout: 5000, getElementError: message => new Error(message ?? 'Element not found') })
  // анимации в тестах не нужны: переходы мгновенные, а WAAPI в happy-dom кидает AbortError при отмене
  MotionGlobalConfig.skipAnimations = true

  // happy-dom не реализует эти API — приложение их использует, тестам хватает заглушек
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }) as MediaQueryList
  }
  class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  Object.assign(globalThis, { IntersectionObserver: globalThis.IntersectionObserver ?? NoopObserver, ResizeObserver: globalThis.ResizeObserver ?? NoopObserver })
  HTMLCanvasElement.prototype.getContext = (() => ({
    setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    createRadialGradient: () => ({ addColorStop() {} }), fillStyle: '', strokeStyle: '', lineWidth: 1,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => undefined
  window.scrollTo = () => undefined
}

// The suite never talks to a real Supabase project: requests to *.supabase.co fail fast instead of waiting on DNS.
// Tests that need a response stub `fetch` themselves.
const realFetch = globalThis.fetch
if (realFetch) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (/^https?:\/\/[^/]*\.supabase\.co\b/.test(url)) return Promise.reject(new TypeError('network is disabled in tests'))
    return realFetch(input, init)
  }) as typeof fetch
}
