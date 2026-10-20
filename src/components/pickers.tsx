import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CalendarBlankIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, ClockIcon, XIcon } from '@phosphor-icons/react'
import { useMediaQuery } from '@/data/hooks'
import { toISODate } from '@/lib/format'
import {
  addDays, addMonths, clampISO, daysIn, isoOf, longDate, monthGrid, calendarNames, outOfRange, pad2, parseISO, withTime,
} from '@/lib/calendar'
import { t } from '@/i18n'

/* Our own date, time and list pickers instead of the system ones. The browser's system windows cannot be styled and clash with the design.
   Выпадашка — на десктопе всплывающая карточка у поля, на телефоне — нижняя шторка. */

type Variant = 'box' | 'field' | 'pill' | 'mini' | 'none'

const TRIGGER: Record<Variant, string> = {
  box: 'h-12 w-full rounded-[16px] border border-line bg-white/[0.04] px-4 text-[15.5px]',
  field: 'w-full text-[16.5px]',
  pill: 'h-8 rounded-full border border-line bg-white/[0.04] px-3 text-[13.5px]',
  mini: 'h-6 rounded-full bg-white/[0.06] px-2 text-[12px]',
  none: '',
}

interface TriggerProps {
  anchor: RefObject<HTMLButtonElement | null>
  open: boolean
  onClick: () => void
  variant: Variant
  className?: string
  label: string
  icon?: ReactNode
  children: ReactNode
  empty?: boolean
  chevron?: boolean
}

function Trigger({ anchor, open, onClick, variant, className = '', label, icon, children, empty, chevron }: TriggerProps) {
  return (
    <button
      ref={anchor} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={onClick}
      className={`press inline-flex items-center justify-between gap-2 text-left transition-colors ${open ? 'border-accent/60 bg-accent/[0.08]' : ''} ${TRIGGER[variant]} ${empty ? 'text-fg-4' : 'text-fg'} ${className}`}
    >
      <span className="min-w-0 truncate">{children}</span>
      {chevron ? <CaretDownIcon size={variant === 'mini' ? 10 : 14} weight="bold" className={`shrink-0 text-fg-3 transition-transform ${open ? 'rotate-180' : ''}`} /> : icon}
    </button>
  )
}

function usePicker() {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => { setOpen(false); anchor.current?.focus({ preventScroll: true }) }, [])
  return { anchor, open, setOpen, close }
}

/** A popover card. Escape closes only it, not the sheet below. */
function Popover({ anchor, onClose, title, width = 320, children }: { anchor: RefObject<HTMLElement | null>; onClose: () => void; title: string; width?: number; children: ReactNode }) {
  const desktop = useMediaQuery('(min-width: 640px)')
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose() } }
    const down = (e: PointerEvent) => {
      const target2 = e.target as Node
      if (panel.current?.contains(target2) || anchor.current?.contains(target2)) return
      onClose()
    }
    window.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', down, true)
    return () => { window.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', down, true) }
  }, [anchor, onClose])

  useLayoutEffect(() => {
    if (!desktop) { setPos(null); return }
    const place = () => {
      const a = anchor.current, p = panel.current
      if (!a || !p) return
      const r = a.getBoundingClientRect()
      const w = p.offsetWidth, h = p.offsetHeight
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12
      let top = h <= below || below >= above ? r.bottom + 8 : r.top - h - 8
      top = Math.max(12, Math.min(top, window.innerHeight - h - 12))
      const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12))
      setPos(prev => (prev && prev.left === left && prev.top === top ? prev : { left, top }))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const ro = typeof ResizeObserver !== 'undefined' && panel.current ? new ResizeObserver(place) : null
    if (ro && panel.current) ro.observe(panel.current)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); ro?.disconnect() }
  }, [anchor, desktop])

  return createPortal(
    desktop ? (
      <div
        ref={panel} role="dialog" aria-label={title}
        className="pop-in glass-strong fixed z-[80] max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-[26px] p-3.5"
        style={{ width, left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      >
        {children}
      </div>
    ) : (
      <>
        <div aria-hidden className="fade-in fixed inset-0 z-[80] bg-black/55" onPointerDown={onClose} />
        <div
          ref={panel} role="dialog" aria-modal="true" aria-label={title}
          className="sheet-up glass-strong fixed inset-x-0 bottom-0 z-[81] mx-auto max-h-[90dvh] w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-t-[30px] px-4 pb-[calc(18px+var(--safe-bottom))] pt-2.5"
        >
          <div className="mx-auto mb-2 h-[5px] w-10 rounded-full bg-white/20" />
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[17px] font-semibold tracking-[-0.01em]">{title}</span>
            <button type="button" aria-label={t('Close')} onClick={onClose} className="press grid h-8 w-8 place-items-center rounded-full bg-white/[0.08] text-fg-2"><XIcon size={14} weight="bold" /></button>
          </div>
          {children}
        </div>
      </>
    ),
    document.body,
  )
}

const navBtn = 'press grid h-9 w-9 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-white/[0.07] disabled:opacity-25'
const SELECTED = 'bg-[linear-gradient(145deg,#b9adff,#7f63ff)] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(124_92_255/0.9)]'

/** A calendar that switches the month, months and years. Keyboard-controlled: arrows, PageUp/PageDown, Home/End. */
export function Calendar({ value, onPick, min, max, autoFocus }: { value?: string; onPick: (iso: string) => void; min?: string; max?: string; autoFocus?: boolean }) {
  const today = toISODate(Date.now())
  const start = parseISO(value) ?? parseISO(clampISO(today, min, max))!
  const [view, setView] = useState({ y: start.y, m: start.m })
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days')
  const [focus, setFocus] = useState(isoOf(start.y, start.m, start.d))
  const byKeyboard = useRef(!!autoFocus)
  const grid = useRef<HTMLDivElement>(null)
  const cells = useMemo(() => monthGrid(view.y, view.m), [view.y, view.m])

  useEffect(() => {
    if (!byKeyboard.current || mode !== 'days') return
    grid.current?.querySelector<HTMLElement>(`[data-iso="${focus}"]`)?.focus({ preventScroll: true })
  }, [focus, view, mode])

  const go = (next: string) => {
    const iso = clampISO(next, min, max)
    const p = parseISO(iso)!
    byKeyboard.current = true
    setFocus(iso)
    setView({ y: p.y, m: p.m })
  }
  const onKey = (e: React.KeyboardEvent) => {
    const map: Record<string, string> = {
      ArrowLeft: addDays(focus, -1), ArrowRight: addDays(focus, 1), ArrowUp: addDays(focus, -7), ArrowDown: addDays(focus, 7),
      PageUp: addMonths(focus, e.shiftKey ? -12 : -1), PageDown: addMonths(focus, e.shiftKey ? 12 : 1),
    }
    let next = map[e.key]
    if (e.key === 'Home' || e.key === 'End') {
      const p = parseISO(focus)!
      const wd = (new Date(p.y, p.m, p.d).getDay() + 6) % 7
      next = addDays(focus, e.key === 'Home' ? -wd : 6 - wd)
    }
    if (!next) return
    e.preventDefault()
    go(next)
  }

  const shift = (n: number) => {
    if (mode === 'days') setView(v => { const date = new Date(v.y, v.m + n, 1); return { y: date.getFullYear(), m: date.getMonth() } })
    else if (mode === 'months') setView(v => ({ ...v, y: v.y + n }))
    else setView(v => ({ ...v, y: v.y + n * 12 }))
  }
  const yearBase = view.y - (((view.y % 12) + 12) % 12)
  const title = mode === 'days' ? `${calendarNames().monthsNom[view.m]} ${view.y}` : mode === 'months' ? String(view.y) : `${yearBase}–${yearBase + 11}`
  const prevOff = mode === 'days' && !!min && isoOf(view.y, view.m, 1) <= min
  const nextOff = mode === 'days' && !!max && isoOf(view.y, view.m + 1, 1) > max

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button" onClick={() => setMode(m => (m === 'days' ? 'months' : m === 'months' ? 'years' : 'days'))}
          className="press flex h-9 items-center gap-1.5 rounded-full px-3 text-[16px] font-semibold tracking-[-0.01em] hover:bg-white/[0.07]" aria-live="polite"
        >
          {title}
          <CaretDownIcon size={12} weight="bold" className={`text-fg-3 transition-transform ${mode === 'days' ? '' : 'rotate-180'}`} />
        </button>
        <span className="flex-1" />
        <button type="button" aria-label={t('Back')} className={navBtn} disabled={prevOff} onClick={() => shift(-1)}><CaretLeftIcon size={16} weight="bold" /></button>
        <button type="button" aria-label={t('Next')} className={navBtn} disabled={nextOff} onClick={() => shift(1)}><CaretRightIcon size={16} weight="bold" /></button>
      </div>

      {mode === 'days' && (
        <div key={`${view.y}-${view.m}`} className="cal-in">
          <div className="grid grid-cols-7 pb-1">
            {calendarNames().weekAbbr.map((w, i) => <span key={w} className={`micro grid h-7 place-items-center ${i > 4 ? 'text-fg-3' : 'text-fg-4'}`}>{w}</span>)}
          </div>
          <div ref={grid} role="grid" className="grid grid-cols-7 gap-y-0.5" onKeyDown={onKey}>
            {cells.map(c => {
              const off = outOfRange(c.iso, min, max)
              const sel = c.iso === value
              return (
                <button
                  key={c.iso} type="button" role="gridcell" data-iso={c.iso} disabled={off} tabIndex={c.iso === focus ? 0 : -1}
                  aria-label={longDate(c.iso)} aria-selected={sel} aria-current={c.iso === today ? 'date' : undefined}
                  onClick={() => onPick(c.iso)} onFocus={() => setFocus(c.iso)}
                  className={`press tnum relative mx-auto grid h-10 w-10 place-items-center rounded-full text-[15px] ${
                    sel ? SELECTED : c.inMonth ? 'text-fg hover:bg-white/[0.08]' : 'text-fg-4 hover:bg-white/[0.05]'
                  } ${off ? 'pointer-events-none opacity-30' : ''} ${c.iso === today && !sel ? 'text-accent ring-1 ring-inset ring-accent/55' : ''}`}
                >
                  {c.d}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {mode === 'months' && (
        <div className="cal-in grid grid-cols-3 gap-1.5 py-1">
          {calendarNames().monthsAbbr.map((m, i) => {
            const cur = i === start.m && view.y === start.y
            const off = (!!min && isoOf(view.y, i, daysIn(view.y, i)) < min) || (!!max && isoOf(view.y, i, 1) > max)
            return (
              <button key={m} type="button" disabled={off} onClick={() => { setView(v => ({ ...v, m: i })); setMode('days') }}
                className={`press h-12 rounded-[16px] text-[15px] capitalize ${cur ? SELECTED : 'bg-white/[0.045] text-fg hover:bg-white/[0.09]'} ${off ? 'pointer-events-none opacity-30' : ''}`}>{m}</button>
            )
          })}
        </div>
      )}

      {mode === 'years' && (
        <div className="cal-in grid grid-cols-3 gap-1.5 py-1">
          {Array.from({ length: 12 }, (_, i) => yearBase + i).map(y => {
            const off = (!!min && y < Number(min.slice(0, 4))) || (!!max && y > Number(max.slice(0, 4)))
            return (
              <button key={y} type="button" disabled={off} onClick={() => { setView(v => ({ ...v, y })); setMode('months') }}
                className={`press tnum h-12 rounded-[16px] text-[15px] ${y === start.y ? SELECTED : 'bg-white/[0.045] text-fg hover:bg-white/[0.09]'} ${y === Number(today.slice(0, 4)) && y !== start.y ? 'ring-1 ring-inset ring-accent/55' : ''} ${off ? 'pointer-events-none opacity-30' : ''}`}>{y}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const ROW = 40

/** A drum column: scrolled by finger or wheel, tapping a value selects it. */
function Wheel({ items, value, onChange, label }: { items: number[]; value: number; onChange: (v: number) => void; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const idx = Math.max(0, items.indexOf(value))

  useLayoutEffect(() => { if (box.current) box.current.scrollTop = idx * ROW }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), [])

  const toIdx = (i: number, smooth: boolean) => {
    const el = box.current
    if (!el) return
    if (smooth && el.scrollTo) el.scrollTo({ top: i * ROW, behavior: 'smooth' })
    else el.scrollTop = i * ROW
  }
  useEffect(() => {
    const el = box.current
    if (el && Math.abs(el.scrollTop - idx * ROW) > ROW / 2) toIdx(idx, true)
  }, [idx])

  const onScroll = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const el = box.current
      if (!el) return
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)))
      if (items[i] !== value) onChange(items[i])
    }, 90)
  }
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!d) return
    e.preventDefault()
    const i = Math.min(items.length - 1, Math.max(0, idx + d))
    onChange(items[i])
  }

  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 rounded-[14px] border border-line-2 bg-white/[0.07]" />
      <div
        ref={box} role="listbox" aria-label={label} tabIndex={0} onScroll={onScroll} onKeyDown={onKey}
        className="no-scrollbar relative h-[120px] snap-y snap-mandatory overflow-y-auto overscroll-contain py-10 outline-none [mask-image:linear-gradient(180deg,transparent,#000_30%,#000_70%,transparent)] focus-visible:[&>*[aria-selected=true]]:text-accent"
      >
        {items.map((n, i) => (
          <button
            key={n} type="button" role="option" aria-selected={n === value} tabIndex={-1}
            onClick={() => { onChange(n); toIdx(i, true) }}
            className={`tnum grid h-10 w-full snap-center place-items-center text-[20px] transition-colors ${n === value ? 'font-semibold text-fg' : 'text-fg-3'}`}
          >
            {pad2(n)}
          </button>
        ))}
      </div>
    </div>
  )
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

const sideBtn = 'press h-10 rounded-full px-4 text-[14.5px] font-medium text-fg-2 hover:bg-white/[0.07]'
const doneBtn = 'press h-10 rounded-full bg-[#f5f5f7] px-5 text-[14.5px] font-semibold text-[#07070b]'

interface DateProps {
  value: string
  onChange: (iso: string) => void
  min?: string
  max?: string
  /** Show a "Delete" button (the value becomes empty). */
  clearable?: boolean
  placeholder?: string
  label: string
  variant?: Variant
  className?: string
  /** Without a year: "October 10". */
  hideYear?: boolean
  /** A custom text in the field instead of the date. */
  render?: (iso: string) => ReactNode
}

/** A date picker. The value is "YYYY-MM-DD" or an empty string. */
export function DateField({ value, onChange, min, max, clearable, placeholder = t('Pick a date'), label, variant = 'box', className, hideYear, render }: DateProps) {
  const { anchor, open, setOpen, close } = usePicker()
  const today = toISODate(Date.now())
  const valid = !!parseISO(value)
  const pick = (iso: string) => { onChange(iso); close() }
  return (
    <>
      <Trigger anchor={anchor} open={open} onClick={() => setOpen(o => !o)} variant={variant} className={className} label={label} empty={!valid} icon={<CalendarBlankIcon size={variant === 'mini' ? 12 : 18} className="shrink-0 text-fg-3" />}>
        {valid ? (render ? render(value) : longDate(value, !hideYear)) : placeholder}
      </Trigger>
      {open && (
        <Popover anchor={anchor} onClose={close} title={label}>
          <Calendar value={valid ? value : undefined} onPick={pick} min={min} max={max} autoFocus />
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2.5">
            {clearable && valid ? <button type="button" className={sideBtn} onClick={() => pick('')}>{t('Delete')}</button> : <span />}
            <button type="button" className={sideBtn + ' text-accent'} disabled={outOfRange(today, min, max)} onClick={() => pick(today)}>{t('Today')}</button>
          </div>
        </Popover>
      )}
    </>
  )
}

/** A date and time picker. The value is in milliseconds. */
export function DateTimeField({ value, onChange, label, variant = 'box', className, min }: { value: number; onChange: (value2: number) => void; label: string; variant?: Variant; className?: string; min?: string }) {
  const { anchor, open, setOpen, close } = usePicker()
  const d = new Date(value)
  const iso = toISODate(d)
  const set = (nextIso: string, h = d.getHours(), m = d.getMinutes()) => { const value3 = withTime(nextIso, h, m); if (!Number.isNaN(value3)) onChange(value3) }
  const now = () => { onChange(Date.now()) }
  return (
    <>
      <Trigger anchor={anchor} open={open} onClick={() => setOpen(o => !o)} variant={variant} className={className} label={label} icon={<ClockIcon size={18} className="shrink-0 text-fg-3" />}>
        <span>{longDate(iso)}</span><span className="text-fg-3"> · </span><span className="tnum">{pad2(d.getHours())}:{pad2(d.getMinutes())}</span>
      </Trigger>
      {open && (
        <Popover anchor={anchor} onClose={close} title={label}>
          <Calendar value={iso} onPick={nextIso => set(nextIso)} min={min} autoFocus />
          <div className="mt-2 flex items-center gap-3 border-t border-line pt-3">
            <div className="grid w-[132px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-1">
              <Wheel items={HOURS} value={d.getHours()} onChange={h => set(iso, h, d.getMinutes())} label={t('Hours')} />
              <span className="pb-0.5 text-[20px] font-semibold text-fg-3">:</span>
              <Wheel items={MINUTES} value={d.getMinutes()} onChange={m => set(iso, d.getHours(), m)} label={t('Minutes')} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-end gap-1.5">
              <button type="button" className={sideBtn + ' text-accent'} onClick={now}>{t('Now')}</button>
              <button type="button" className={doneBtn} onClick={close}>{t('Done')}</button>
            </div>
          </div>
        </Popover>
      )}
    </>
  )
}

export interface Option<T extends string | number> { value: T; label: ReactNode; hint?: string }

/** A choice from a list. `columns` > 1 lays the options out in a grid (days of the month, months). */
export function SelectField<T extends string | number>({
  value, options, onChange, label, placeholder = t('Select'), variant = 'box', className, columns = 1, width, shown,
}: {
  value: T | ''
  options: Option<T>[]
  onChange: (v: T) => void
  label: string
  placeholder?: string
  variant?: Variant
  className?: string
  columns?: number
  width?: number
  /** The text in the field, if it must differ from the option's label. */
  shown?: ReactNode
}) {
  const { anchor, open, setOpen, close } = usePicker()
  const list = useRef<HTMLDivElement>(null)
  const current = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    const el = list.current
    const sel = el?.querySelector<HTMLElement>('[aria-selected="true"]') ?? el?.querySelector<HTMLElement>('button')
    sel?.focus({ preventScroll: true })
    sel?.scrollIntoView?.({ block: 'center' })
  }, [open])

  const onKey = (e: React.KeyboardEvent) => {
    const keys = columns > 1 ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns } : { ArrowUp: -1, ArrowDown: 1 }
    const step = (keys as Record<string, number>)[e.key]
    if (!step) return
    const all = [...(list.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    const i = all.indexOf(document.activeElement as HTMLElement)
    const next = all[Math.min(all.length - 1, Math.max(0, i + step))]
    if (next) { e.preventDefault(); next.focus() }
  }

  return (
    <>
      <Trigger anchor={anchor} open={open} onClick={() => setOpen(o => !o)} variant={variant} className={className} label={label} empty={!current && !shown} chevron>
        {shown ?? current?.label ?? placeholder}
      </Trigger>
      {open && (
        <Popover anchor={anchor} onClose={close} title={label} width={width ?? (columns > 1 ? 316 : Math.min(360, Math.max(220, anchor.current?.offsetWidth ?? 240)))}>
          <div ref={list} role="listbox" aria-label={label} onKeyDown={onKey} className={columns > 1 ? 'grid gap-1.5' : 'flex flex-col gap-0.5'} style={columns > 1 ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
            {options.map(o => {
              const sel = o.value === value
              return (
                <button
                  key={String(o.value)} type="button" role="option" aria-selected={sel}
                  onClick={() => { onChange(o.value); close() }}
                  className={`press flex items-center gap-2 text-left ${columns > 1 ? 'h-11 justify-center rounded-[14px] text-[15px]' : 'min-h-11 rounded-[14px] px-3 py-2 text-[15px]'} ${sel ? SELECTED : 'text-fg hover:bg-white/[0.07]'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}{o.hint && <span className={`block text-[12px] font-normal ${sel ? 'text-white/70' : 'text-fg-3'}`}>{o.hint}</span>}</span>
                  {columns === 1 && sel && <CheckIcon size={15} weight="bold" className="shrink-0" />}
                </button>
              )
            })}
          </div>
        </Popover>
      )}
    </>
  )
}
