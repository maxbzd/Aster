import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { XIcon } from '@phosphor-icons/react'
import { useAllInteractions, useAllPeople, useNow } from '@/data/hooks'
import { yearReview, yearsWithData, type YearReview } from '@/data/year'
import { fullName } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import { CitiesSlide, IntroSlide, LostSlide, MonthsSlide, NewPeopleSlide, ReciprocitySlide, SummarySlide, TopPersonSlide, TotalSlide, WarmestSlide, type SlideCtx, type SlideDef } from './year/Slides'
import { t, tn } from '@/i18n'

const SLIDE_MS = 7000

const SLIDES: SlideDef[] = [
  { key: 'intro', colors: ['#7c5cff', '#ff5e8a', '#1b1250'], show: () => true, render: (r, ctx) => <IntroSlide r={r} ctx={ctx} /> },
  { key: 'total', colors: ['#ff7a3d', '#ffb547', '#5a1a06'], show: r => r.hasData, render: r => <TotalSlide r={r} /> },
  { key: 'months', colors: ['#2563ff', '#5fd0ff', '#081a52'], show: r => r.hasData, render: r => <MonthsSlide r={r} /> },
  { key: 'new', colors: ['#14c08f', '#8af5cf', '#05352f'], show: r => r.newPeople.length > 0, render: r => <NewPeopleSlide r={r} /> },
  { key: 'top', colors: ['#ff3d7f', '#ff9d8a', '#5a0c30'], show: r => r.topPeople.length > 0, render: r => <TopPersonSlide r={r} /> },
  { key: 'cities', colors: ['#a43dff', '#ff7ae0', '#2f0c58'], show: r => r.cities.length > 0, render: r => <CitiesSlide r={r} /> },
  { key: 'warmest', colors: ['#f0a500', '#ff6a3d', '#5a3000'], show: r => r.warmest.length > 0, render: r => <WarmestSlide r={r} /> },
  { key: 'reciprocity', colors: ['#45c8ff', '#7c5cff', '#0a2460'], show: r => r.reciprocity.level !== 'unknown', render: r => <ReciprocitySlide r={r} /> },
  { key: 'lost', colors: ['#6f8fb5', '#8f7cff', '#141a30'], show: r => r.lost.length > 0, render: r => <LostSlide r={r} /> },
  { key: 'summary', colors: ['#7c5cff', '#ff7a3d', '#14c08f'], show: r => r.hasData, render: (r, ctx) => <SummarySlide r={r} ctx={ctx} /> },
]

export function summaryText(r: YearReview): string {
  const lines = [t('My {year} in people — “{title}”', { year: r.year, title: r.title }), t('Contacts: {total} (meetings {v}, calls {calls}, messages {messages}).', { total: r.total, v: r.meetings + r.events, calls: r.calls, messages: r.messages })]
  if (r.newPeople.length) lines.push(t('New people: {count}.', { count: r.newPeople.length }))
  if (r.topPeople[0]) lines.push(t('Most interaction — with “{name}” ({count} {plural}).', { name: fullName(r.topPeople[0].person), count: r.topPeople[0].count, plural: tn(r.topPeople[0].count, 'time', 'times') }))
  if (r.cities.length) lines.push(t('Meetings in {count} {plural}: {v}.', { count: r.cities.length, plural: tn(r.cities.length, 'city', 'cities'), v: r.cities.slice(0, 4).map(c => c.city).join(', ') }))
  return lines.join('\n')
}

/** «Итоги года»: история на весь экран. Тап — дальше или назад, удержание — пауза. */
export function Year() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const people = useAllPeople()
  const ints = useAllInteractions()
  const now = useNow(3_600_000)
  const [params, setParams] = useSearchParams()
  const years = useMemo(() => yearsWithData(ints, now), [ints, now])
  const current = new Date(now).getFullYear()
  const wanted = Number(params.get('y')) || (ints.some(i => new Date(i.date).getFullYear() === current) ? current : years[0] ?? current)
  const year = years.includes(wanted) ? wanted : years[0] ?? current
  const review = useMemo(() => yearReview(year, people ?? [], ints, now), [year, people, ints, now])
  const slides = useMemo(() => SLIDES.filter(s => s.show(review)), [review])

  const [idx, setIdx] = useState(0)
  // полоска прогресса двигается напрямую через ref: перерисовывать весь экран 60 раз в секунду незачем
  const bar = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const paused = useRef(false)
  const elapsed = useRef(0)
  const lastTick = useRef(0)
  const press = useRef<{ t: number; x: number } | null>(null)
  const safeIdx = Math.min(idx, slides.length - 1)
  const isLast = safeIdx === slides.length - 1

  const go = useCallback((to: number) => {
    elapsed.current = 0
    if (bar.current) bar.current.style.transform = 'scaleX(0)'
    setIdx(Math.max(0, Math.min(slides.length - 1, to)))
  }, [slides.length])
  const next = useCallback(() => { haptic(5); go(safeIdx + 1) }, [go, safeIdx])
  const prev = useCallback(() => { haptic(5); go(safeIdx - 1) }, [go, safeIdx])
  const close = useCallback(() => nav(-1), [nav])

  useEffect(() => { go(0) }, [year]) // eslint-disable-line react-hooks/exhaustive-deps

  // таймер: идёт, пока не нажат экран и открыта вкладка; на последнем слайде не листает
  useEffect(() => {
    if (isLast) return
    let raf = 0
    lastTick.current = performance.now()
    const tick = (value: number) => {
      const dt = value - lastTick.current
      lastTick.current = value
      if (!paused.current && !document.hidden) elapsed.current += dt
      const p = Math.min(1, elapsed.current / SLIDE_MS)
      if (bar.current) bar.current.style.transform = `scaleX(${p})`
      if (p >= 1) { go(safeIdx + 1); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [safeIdx, isLast, go])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, close])

  const ctx: SlideCtx = {
    years, close, copied,
    setYear: y => setParams(p => { const n = new URLSearchParams(p); n.set('y', String(y)); return n }, { replace: true }),
    copy: async () => {
      try { await navigator.clipboard.writeText(summaryText(review)); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { toast(t("Couldn't copy"), 'info') }
    },
  }

  const slide = slides[safeIdx]!
  const [c1, c2, c3] = slide.colors

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('a,button,[data-nav-ignore]')) { press.current = null; return }
    press.current = { t: performance.now(), x: e.clientX }
    paused.current = true
  }
  const onUp = (e: React.PointerEvent) => {
    paused.current = false
    const p = press.current
    press.current = null
    if (!p) return
    // короткое касание — переход; долгое — это была пауза (подержать, чтобы разглядеть)
    if (performance.now() - p.t > 260) return
    const w = (e.currentTarget as HTMLElement).clientWidth
    if (p.x < w * 0.3) prev(); else next()
  }

  return (
    <div className="fixed inset-0 z-[60] select-none overflow-hidden bg-[#05060a] text-white" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { paused.current = false; press.current = null }} role="presentation">
      {/* фон слайда: три дрейфующих пятна цвета */}
      <AnimatePresence initial={false}>
        <motion.div key={slide.key} aria-hidden className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9 }}>
          <div className="absolute inset-0" style={{ background: `radial-gradient(120% 80% at 50% 110%, ${c3}, #05060a 70%)` }} />
          <motion.div className="absolute -left-[20%] -top-[10%] h-[70%] w-[90%] rounded-full opacity-60" style={{ background: `radial-gradient(closest-side, ${c1}, transparent)` }} animate={{ x: [0, 50, -20, 0], y: [0, 40, 10, 0] }} transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }} />
          <motion.div className="absolute -bottom-[15%] -right-[25%] h-[75%] w-[95%] rounded-full opacity-55" style={{ background: `radial-gradient(closest-side, ${c2}, transparent)` }} animate={{ x: [0, -60, 20, 0], y: [0, -30, -50, 0] }} transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }} />
        </motion.div>
      </AnimatePresence>

      {/* прогресс */}
      <div className="absolute inset-x-0 top-0 z-10 flex gap-1.5 px-4 pt-[calc(14px+var(--safe-top))]">
        {slides.map((s, i) => (
          <div key={s.key} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
            <div ref={i === safeIdx ? bar : undefined} className="h-full w-full origin-left rounded-full bg-white will-change-transform" style={{ transform: i < safeIdx || (i === safeIdx && isLast) ? 'scaleX(1)' : 'scaleX(0)' }} />
          </div>
        ))}
      </div>
      <button type="button" aria-label={t('Close')} onClick={close} className="press absolute right-3 top-[calc(26px+var(--safe-top))] z-20 grid h-10 w-10 place-items-center rounded-full bg-black/30 text-white"><XIcon size={18} weight="bold" /></button>

      {/* слайд */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${year}-${slide.key}`} className="absolute inset-0 mx-auto flex max-w-[460px] flex-col px-7 pb-[calc(44px+var(--safe-bottom))] pt-[calc(70px+var(--safe-top))]"
          initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: 0.35 }}>
          <div className="min-h-0 flex-1">{slide.render(review, ctx)}</div>
          {!isLast && <div className="pt-3 text-center text-[12px] text-white/40">{t('tap to go on · hold to pause')}</div>}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
