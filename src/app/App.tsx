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

// Второстепенные экраны грузятся по требованию (офлайн их всё равно кеширует service worker)
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

/** Восстанавливаем прокрутку при «назад», при переходе вперёд — наверх. */
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
  // смена экрана закрывает открытые шторки и поиск
  const pendingShare = useRef<string | null>(null)
  useEffect(() => {
    useUI.getState().close(); useUI.getState().setSearch(false)
    if (pendingShare.current && location.pathname === '/reserve') {
      const smart = pendingShare.current
      pendingShare.current = null
      setTimeout(() => useUI.getState().open({ kind: 'leadEdit', smart }), 120)
    }
  }, [location.pathname])

  // «Поделиться» из другого приложения (Android PWA): ссылка или текст сразу попадают в новый контакт резерва
  const onboarded = !!settings?.onboarded
  // ссылка «сбросить пароль» из письма: сразу открываем форму нового пароля
  const recovery = useCloud(s => s.recovery && !!s.userId)
  useEffect(() => { if (recovery) useUI.getState().open({ kind: 'cloud' }) }, [recovery])
  // после входа в аккаунт один раз включаем серверную нейросеть и распознавание речи, если на сервере есть ключи и свой выбор не сделан
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
      try { localStorage.setItem(flag, '1') } catch { /* хранилище закрыто: попробуем при следующем запуске */ }
    })()
  }, [userId, server, settings])
  // возврат из TickTick после согласия: показываем результат и открываем шторку подключения
  useEffect(() => {
    if (!onboarded) return
    const r = takeReturnResult()
    if (!r) return
    useUI.getState().toast(returnText(r), r === 'ok' ? 'check' : 'info')
    useUI.getState().open({ kind: 'ticktick' })
  }, [onboarded])
  // просим браузер не вычищать хранилище: все данные живут только в нём
  useEffect(() => { if (onboarded) navigator.storage?.persist?.().catch(() => undefined) }, [onboarded])
  // после первой отрисовки в фоне подгружаем остальные экраны и шторки — переходы мгновенные, офлайн работает
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
    // заголовок страницы («Имя — должность | LinkedIn») полезен, только если текста нет
    const cleanTitle = title.replace(/\s*[|•·-]\s*(?:LinkedIn|Instagram|Telegram|Facebook|X|Twitter)\b.*$/i, '').replace(/\s*\(@[\w.]+\)\s*$/, '')
    const parts = [...new Set([text || cleanTitle, url].filter(Boolean))]
    if (!parts.length) return
    window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    const smart = [...new Set(parts)].join('\n')
    // переход на «Резерв» закрывает шторки, поэтому форму открываем уже после него
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
