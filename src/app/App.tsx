import { AnimatePresence, MotionConfig } from 'motion/react'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type ComponentType } from 'react'
import { HashRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router'
import { useSettings } from '@/data/hooks'
import { useUI } from './store'
import { useCloud } from '@/cloud/store'
import { useServerStatus } from '@/ai/managed'
import { AI_DEFAULTS, serverSetup } from '@/ai/autoSetup'
import { patchAi, patchStt } from '@/data/actions'
import { returnText, takeReturnResult } from '@/ticktick/cycle'
import { SpaceBackground } from '@/components/Page'
import { Sidebar, TabBar } from '@/components/Nav'
import { Toasts } from '@/components/Toasts'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SheetHost, prefetchSheets } from '@/sheets/SheetHost'
import { SearchOverlay } from '@/components/SearchOverlay'
import { Today } from '@/screens/Today'
import { People } from '@/screens/People'
import { Me } from '@/screens/Me'

// Secondary screens are loaded on demand (offline, the service worker caches them anyway)
const screenLoaders: (() => Promise<unknown>)[] = []
const lazyScreen = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => {
  screenLoaders.push(load)
  const C = lazy<ComponentType>(() => load().then(m => ({ default: m[name] })))
  return () => <Suspense fallback={null}><C /></Suspense>
}
const PersonProfile = lazyScreen(() => import('@/screens/PersonProfile'), 'PersonProfile')
const Onboarding = lazyScreen(() => import('@/screens/Onboarding'), 'Onboarding')
const Orbit = lazyScreen(() => import('@/screens/Orbit'), 'Orbit')
const Pulse = lazyScreen(() => import('@/screens/Pulse'), 'Pulse')
const VoiceHost = lazy(() => import('@/voice/VoiceHost').then(m => ({ default: m.VoiceHost })))
const Eval = lazyScreen(() => import('@/screens/Eval'), 'Eval')
const Chat = lazyScreen(() => import('@/screens/Chat'), 'Chat')
const Year = lazyScreen(() => import('@/screens/Year'), 'Year')
const Graph = lazyScreen(() => import('@/screens/Graph'), 'Graph')
const WeakTies = lazyScreen(() => import('@/screens/WeakTies'), 'WeakTies')
const Review = lazyScreen(() => import('@/screens/Review'), 'Review')
const Capture = lazyScreen(() => import('@/screens/Capture'), 'Capture')
const EventMode = lazyScreen(() => import('@/screens/EventMode'), 'EventMode')
const Intros = lazyScreen(() => import('@/screens/Intros'), 'Intros')
const Weekly = lazyScreen(() => import('@/screens/Weekly'), 'Weekly')
const Reserve = lazyScreen(() => import('@/screens/Reserve'), 'Reserve')

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <HashRouter>
        <Shell />
      </HashRouter>
    </MotionConfig>
  )
}

/** Restore the scroll position on "back"; going forward, scroll to the top. */
function useScrollMemory(key: string) {
  const navType = useNavigationType()
  const positions = useRef(new Map<string, number>())
  useEffect(() => {
    const save = () => positions.current.set(key, window.scrollY)
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [key])
  useLayoutEffect(() => {
    const y = navType === 'POP' ? positions.current.get(key) ?? 0 : 0
    requestAnimationFrame(() => window.scrollTo(0, y))
  }, [key, navType])
}

function Shell() {
  const settings = useSettings()
  const location = useLocation()
  const setSearch = useUI(s => s.setSearch)
  const nav = useNavigate()
  useScrollMemory(location.pathname)
  // changing the screen closes open sheets and search
  const pendingShare = useRef<string | null>(null)
  useEffect(() => {
    useUI.getState().close(); useUI.getState().setSearch(false)
    if (pendingShare.current && location.pathname === '/reserve') {
      const smart = pendingShare.current
      pendingShare.current = null
      setTimeout(() => useUI.getState().open({ kind: 'leadEdit', smart }), 120)
    }
  }, [location.pathname])

  // "Share" from another app (Android PWA): a link or text goes straight into a new reserve contact
  const onboarded = !!settings?.onboarded
  // a "reset password" link from an email: open the new-password form at once
  const recovery = useCloud(s => s.recovery && !!s.userId)
  useEffect(() => { if (recovery) useUI.getState().open({ kind: 'cloud' }) }, [recovery])
  // after signing in, enable the server-side model and speech recognition once, if the server has keys and the person has not chosen otherwise
  const server = useServerStatus()
  const userId = useCloud(s => s.userId)
  useEffect(() => {
    if (!userId || !server || !settings) return
    const flag = `aster.server-auto.${userId}`
    try { if (localStorage.getItem(flag)) return } catch { return }
    const patch = serverSetup(server, settings)
    void (async () => {
      if (patch.ai) await patchAi(patch.ai, AI_DEFAULTS)
      if (patch.stt) await patchStt(patch.stt)
      try { localStorage.setItem(flag, '1') } catch { /* storage is blocked: we will try on the next start */ }
    })()
  }, [userId, server, settings])
  // the return from TickTick after consent: show the result and open the connection sheet
  useEffect(() => {
    if (!onboarded) return
    const r = takeReturnResult()
    if (!r) return
    useUI.getState().toast(returnText(r), r === 'ok' ? 'check' : 'info')
    useUI.getState().open({ kind: 'ticktick' })
  }, [onboarded])
  // ask the browser not to clear storage: all the data lives only there
  useEffect(() => { if (onboarded) navigator.storage?.persist?.().catch(() => undefined) }, [onboarded])
  // after the first render, load the remaining screens and sheets in the background: transitions are instant and offline works
  useEffect(() => {
    if (!onboarded) return
    const run = () => { for (const l of screenLoaders) l().catch(() => undefined); prefetchSheets() }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
    if (w.requestIdleCallback) { const h = w.requestIdleCallback(run, { timeout: 5000 }); return () => w.cancelIdleCallback?.(h) }
    const timer = setTimeout(run, 2500)
    return () => clearTimeout(timer)
  }, [onboarded])
  useEffect(() => {
    if (!onboarded) return
    const sp = new URLSearchParams(window.location.search)
    const [title, text, url] = ['title', 'text', 'url'].map(k => sp.get(k)?.trim() ?? '')
    // the page title ("Name - position | LinkedIn") is useful only if there is no text
    const cleanTitle = title.replace(/\s*[|•·-]\s*(?:LinkedIn|Instagram|Telegram|Facebook|X|Twitter)\b.*$/i, '').replace(/\s*\(@[\w.]+\)\s*$/, '')
    const parts = [...new Set([text || cleanTitle, url].filter(Boolean))]
    if (!parts.length) return
    window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    const smart = [...new Set(parts)].join('\n')
    // going to "Reserve" closes sheets, so the form is opened after it
    if (location.pathname === '/reserve') useUI.getState().open({ kind: 'leadEdit', smart })
    else { pendingShare.current = smart; nav('/reserve') }
  }, [onboarded]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearch])

  if (settings === undefined) return <SpaceBackground />
  if (!settings?.onboarded) {
    return (
      <>
        <Onboarding />
        <SheetHost />
        <Toasts />
        <div className="grain" />
      </>
    )
  }

  const immersive = /^\/(review|capture|event|year|chat)/.test(location.pathname)

  return (
    <>
      <SpaceBackground />
      {!immersive && <Sidebar />}
      <main className={immersive ? '' : 'lg:pl-[264px]'}>
        <ErrorBoundary inline key={location.pathname}>
        <AnimatePresence mode="wait" initial={false}>
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Today />} />
            <Route path="/people" element={<People />} />
            <Route path="/person/:id" element={<PersonProfile />} />
            <Route path="/orbit" element={<Orbit />} />
            <Route path="/me" element={<Me />} />
            <Route path="/pulse" element={<Pulse />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/eval" element={<Eval />} />
            <Route path="/year" element={<Year />} />
            <Route path="/graph" element={<Graph />} />
            <Route path="/weak" element={<WeakTies />} />
            <Route path="/review" element={<Review />} />
            <Route path="/capture" element={<Capture />} />
            <Route path="/event" element={<EventMode />} />
            <Route path="/intros" element={<Intros />} />
            <Route path="/weekly" element={<Weekly />} />
            <Route path="/reserve" element={<Reserve />} />
            <Route path="*" element={<Today />} />
          </Routes>
        </AnimatePresence>
        </ErrorBoundary>
      </main>
      {!immersive && <TabBar />}
      <SheetHost />
      <SearchOverlay />
      {settings.voice?.wake && <Suspense fallback={null}><VoiceHost /></Suspense>}
      <Toasts />
      <div className="grain" />
    </>
  )
}
