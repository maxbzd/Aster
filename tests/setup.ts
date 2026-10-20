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

// Some tests (the server proxy) run in the node environment: there are no browser stubs there and none are needed.
if (typeof window !== 'undefined') {
  afterEach(() => cleanup())
  // no giant DOM dump in error messages: the report can be read by eye
  // lazy screens and sheets take longer than a second to load in a parallel run: wait up to 5 s
  configure({ asyncUtilTimeout: 5000, getElementError: message => new Error(message ?? 'Element not found') })
  // animations are not needed in tests: transitions are instant, and WAAPI in happy-dom throws AbortError on cancel
  MotionGlobalConfig.skipAnimations = true
  // happy-dom rejects the `finished` promise of a cancelled Web Animation, which surfaces as an unhandled error when a screen unmounts mid-animation
  Element.prototype.animate = (() => ({
    finished: Promise.resolve(), ready: Promise.resolve(), currentTime: 0, playbackRate: 1, playState: 'finished', onfinish: null, oncancel: null,
    cancel() {}, finish() {}, play() {}, pause() {}, reverse() {}, commitStyles() {}, persist() {}, updatePlaybackRate() {}, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof Element.prototype.animate

  // happy-dom does not implement these APIs, the app uses them, and stubs are enough for tests
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
