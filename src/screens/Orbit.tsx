import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRightIcon, PaperPlaneTiltIcon, XIcon } from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { Avatar } from '@/components/Avatar'
import { Chip, Pill } from '@/components/ui'
import { OrbitSwitch } from '@/components/OrbitSwitch'
import { useCircles, useNow, usePeople, useSettings } from '@/data/hooks'
import { CLOSENESS, warmthOf, WARMTH_LABEL, type WarmthLevel, contactAnchor } from '@/data/logic'
import { PALETTES, WARMTH_COLORS } from '@/lib/colors'
import { ago, fullName, jobLine } from '@/lib/format'
import { useReachOut } from '@/app/reach'
import { haptic, useUI } from '@/app/store'
import { useLocalMatches } from '@/ai/hooks'
import { AstraStar } from '@/components/astra/Astra'
import type { Closeness, Person } from '@/data/types'
import { t, tn } from '@/i18n'

const RINGS: { c: Closeness; r: number; size: number; dur: number; dir: 1 | -1 }[] = [
  { c: 1, r: 0.35, size: 48, dur: 140, dir: 1 },
  { c: 2, r: 0.54, size: 38, dur: 190, dir: -1 },
  { c: 3, r: 0.74, size: 31, dur: 240, dir: 1 },
  { c: 4, r: 0.94, size: 24, dur: 300, dir: -1 },
]

const BRIGHT: Record<WarmthLevel, number> = { hot: 1, warm: 1, none: 0.85, cooling: 0.7, cold: 0.42 }

export function Orbit() {
  const people = usePeople()
  const circles = useCircles()
  const settings = useSettings()
  const now = useNow()
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(360)
  const [sel, setSel] = useState<Person | null>(null)
  const [circle, setCircle] = useState<string | null>(null)
  const [stars, setStars] = useState(false)
  const matches = useLocalMatches()
  const open = useUI(s => s.open)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = window.innerHeight - 250
      setSize(Math.max(300, Math.min(w, h, 760)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rings = useMemo(() => {
    const list = (people ?? []).map(p => ({ p, w: warmthOf(p, now) }))
    return RINGS.map(ring => {
      const items = list.filter(x => x.p.closeness === ring.c).sort((a, b) => a.p.id.localeCompare(b.p.id))
      const R = (size / 2) * ring.r
      const avatar = Math.round(ring.size * Math.min(1, Math.max(0.78, size / 460)))
      const capacity = Math.max(4, Math.floor((2 * Math.PI * R) / (avatar + 7)))
      return { ...ring, size: avatar, R, items: items.slice(0, capacity), extra: items.slice(capacity) }
    })
  }, [people, now, size])

  const total = people?.length ?? 0
  const half = size / 2
  const paused = !!sel

  // positions in "Constellations" mode (the orbits freeze in their initial position)
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>()
    for (const ring of rings) ring.items.forEach(({ p }, i) => {
      const a = (i / ring.items.length) * Math.PI * 2 + ring.c * 0.7
      m.set(p.id, { x: half + Math.cos(a) * ring.R, y: half + Math.sin(a) * ring.R })
    })
    return m
  }, [rings, half])
  const lines = stars ? matches.filter(m => pos.has(m.a.id) && pos.has(m.b.id)) : []
  const inPair = new Set(lines.flatMap(m => [m.a.id, m.b.id]))

  return (
    <Page className="flex min-h-[100dvh] flex-col">
      <div className="relative z-10 pt-[calc(18px+var(--safe-top))]">
        <div className="micro text-fg-3">{tn(total, '{n} person', '{n} people')}{' '}{t('· 4 orbits')}</div>
        <h1 className="mt-2 text-[34px] font-bold leading-none tracking-[-0.035em]">
          {t('Orbit')}{' '}<span className="display text-[36px] font-normal text-fg-2">{t('of the network')}</span>
        </h1>
        <OrbitSwitch value="orbit" />
        {circles.length > 0 && (
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
            <button type="button" onClick={() => { haptic(10); setStars(v => !v); setSel(null) }}
              className={`press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors ${stars ? 'text-ink' : 'border border-line bg-white/[0.05] text-[#ffe2c2]'}`}
              style={stars ? { background: 'radial-gradient(circle at 30% 20%, #fff, #ffe2bd 55%, #c9b8ff 100%)' } : undefined}>
              <AstraStar size={13} />{' '}{t('Constellations')}{matches.length ? ` · ${matches.length}` : ''}
            </button>
            <Chip size="sm" active={!circle} onClick={() => setCircle(null)}>{t('All')}</Chip>
            {circles.map(c => (
              <Chip key={c.id} size="sm" color={PALETTES[c.palette].to} active={circle === c.id} onClick={() => setCircle(circle === c.id ? null : c.id)}>{c.name}</Chip>
            ))}
          </div>
        )}
      </div>

      <div ref={box} className="relative flex flex-1 items-center justify-center py-4" onClick={() => setSel(null)}>
        <div className="relative" style={{ width: size, height: size }}>
          {/* a nebula behind the planet */}
          <div aria-hidden className="absolute rounded-full" style={{ inset: '18%', background: 'radial-gradient(closest-side, rgb(255 110 90 / 0.28), rgb(124 92 255 / 0.12) 60%, transparent)', filter: 'blur(30px)' }} />

          {/* rings */}
          {rings.map(ring => (
            <div key={`line-${ring.c}`} aria-hidden className="absolute rounded-full" style={{
              left: half - ring.R, top: half - ring.R, width: ring.R * 2, height: ring.R * 2,
              border: '1px solid rgb(255 255 255 / 0.075)',
              boxShadow: ring.c === 1 ? '0 0 40px -10px rgb(255 160 110 / 0.25) inset' : undefined,
            }} />
          ))}
          {rings.map(ring => (
            <div key={`lbl-${ring.c}`} aria-hidden className="absolute -translate-x-1/2 rounded-full bg-ink/80 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-fg-4"
              style={{ left: half, top: half - ring.R - 8 }}>
              {CLOSENESS[ring.c].name}
            </div>
          ))}

          {/* planet */}
          <Planet size={size * 0.2} center={half} photo={settings?.photo} />

          {/* people */}
          {rings.map(ring => (
            <div key={`ring-${ring.c}`} className="ambient pointer-events-none absolute inset-0 z-[3]" style={{
              animationName: stars ? 'none' : ring.dir === 1 ? 'spin' : 'spin-rev',
              animationDuration: `${ring.dur}s`, animationTimingFunction: 'linear', animationIterationCount: 'infinite',
              animationPlayState: paused ? 'paused' : 'running',
            }}>
              {ring.items.map(({ p, w }, i) => {
                const a = (i / ring.items.length) * Math.PI * 2 + ring.c * 0.7
                const x = half + Math.cos(a) * ring.R
                const y = half + Math.sin(a) * ring.R
                const match = stars ? inPair.has(p.id) : !circle || p.circleIds.includes(circle)
                const isSel = sel?.id === p.id
                return (
                  <div key={p.id} className="absolute" style={{ left: x - ring.size / 2, top: y - ring.size / 2, width: ring.size, height: ring.size }}>
                    <div className="ambient" style={{ animationName: stars ? 'none' : ring.dir === 1 ? 'spin-rev' : 'spin', animationDuration: `${ring.dur}s`, animationTimingFunction: 'linear', animationIterationCount: 'infinite', animationPlayState: paused ? 'paused' : 'running' }}>
                      <motion.button
                        type="button"
                        aria-label={fullName(p)}
                        onClick={e => { e.stopPropagation(); haptic(8); setSel(p) }}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: isSel ? 1.35 : stars && match ? 1.12 : 1, opacity: match ? (stars ? 1 : BRIGHT[w.level]) : 0.12 }}
                        whileHover={{ scale: 1.2 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 22, delay: isSel ? 0 : 0.2 + i * 0.02 + ring.c * 0.08 }}
                        className="pointer-events-auto relative block rounded-full"
                        style={{ zIndex: isSel ? 5 : 1 }}
                      >
                        {(w.level === 'hot' || w.level === 'warm') && match && (
                          <span aria-hidden className="absolute -inset-2 rounded-full" style={{ background: `radial-gradient(closest-side, ${WARMTH_COLORS[w.level]}66, transparent)`, filter: 'blur(4px)' }} />
                        )}
                        <Avatar person={p} size={ring.size} dim={w.level === 'cold'} />
                        {isSel && <span className="absolute -inset-1 rounded-full ring-2 ring-white/80" />}
                      </motion.button>
                    </div>
                  </div>
                )
              })}
              {/* those who did not fit are stars on the orbit */}
              {ring.extra.map(({ p, w }, i) => {
                const a = (i / ring.extra.length) * Math.PI * 2 + 0.31
                const R = ring.R + ((i % 3) - 1) * 6
                return (
                  <span key={p.id} aria-hidden className="absolute h-[3px] w-[3px] rounded-full"
                    style={{ left: half + Math.cos(a) * R, top: half + Math.sin(a) * R, background: WARMTH_COLORS[w.level], opacity: 0.7, boxShadow: `0 0 6px ${WARMTH_COLORS[w.level]}` }} />
                )
              })}
            </div>
          ))}

          {/* constellation lines */}
          {stars && (
            <svg aria-hidden="true" className="absolute inset-0 z-[2] overflow-visible" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              <defs>
                <linearGradient id="constellation" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffd9a8" />
                  <stop offset="100%" stopColor="#a796ff" />
                </linearGradient>
              </defs>
              {lines.map((m, i) => {
                const A = pos.get(m.a.id)!, B = pos.get(m.b.id)!
                const mx = (A.x + B.x) / 2 + (half - (A.x + B.x) / 2) * 0.25
                const my = (A.y + B.y) / 2 + (half - (A.y + B.y) / 2) * 0.25
                const d = `M ${A.x} ${A.y} Q ${mx} ${my} ${B.x} ${B.y}`
                return (
                  <g key={`${m.a.id}-${m.b.id}`} className="cursor-pointer" onClick={e => { e.stopPropagation(); haptic(10); open({ kind: 'intro', aId: m.a.id, bId: m.b.id, reason: m.reason, value: m.value }) }}>
                    <path d={d} fill="none" stroke="url(#constellation)" strokeWidth={6} opacity={0.18} style={{ filter: 'blur(3px)' }} />
                    <motion.path d={d} fill="none" stroke="url(#constellation)" strokeWidth={1.6} strokeLinecap="round" strokeDasharray="4 6"
                      initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.9, delay: i * 0.12 }} />
                    <path d={d} fill="none" stroke="transparent" strokeWidth={18} />
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        {total === 0 && (
          <div className="absolute inset-x-0 bottom-6 text-center text-[15px] text-fg-3">{t('Add people — and they will appear on your orbits')}</div>
        )}
      </div>

      {/* legend */}
      {stars ? (
        <div className="mb-2 text-center text-[13px] text-fg-2">
          {lines.length ? <>{t('Lines show who should be introduced.')}{' '}<span className="text-fg-3">{t('Tap a line.')}</span></> : t('No pairs yet: add a “Looking for now” field to people')}
        </div>
      ) : (
      <div className="mb-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[12.5px] text-fg-3">
        {(['hot', 'warm', 'cooling', 'cold'] as WarmthLevel[]).map(l => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: WARMTH_COLORS[l], boxShadow: `0 0 8px ${WARMTH_COLORS[l]}` }} />{WARMTH_LABEL[l]}
          </span>
        ))}
      </div>
      )}

      <AnimatePresence>{sel && <SelectedCard p={sel} now={now} onClose={() => setSel(null)} />}</AnimatePresence>
    </Page>
  )
}

function Planet({ size, center, photo }: { size: number; center: number; photo?: string }) {
  return (
    <div className="absolute" style={{ left: center - size / 2, top: center - size / 2, width: size, height: size }}>
      <div aria-hidden className="absolute -inset-[45%] rounded-full" style={{ background: 'radial-gradient(closest-side, rgb(255 120 80 / 0.45), rgb(225 60 140 / 0.18) 55%, transparent)', }} />
      <div className="absolute inset-0 overflow-hidden rounded-full" style={{
        background: 'radial-gradient(circle at 34% 28%, #ffe3c4 0%, #ffa25e 22%, #ff5a5f 48%, #c92a7f 72%, #4b1470 100%)',
        boxShadow: 'inset -14px -18px 30px rgb(40 0 60 / 0.55), inset 6px 8px 18px rgb(255 255 255 / 0.25), 0 0 50px rgb(255 110 90 / 0.45)',
      }}>
        <div className="ambient absolute inset-0 rounded-full" style={{ background: 'conic-gradient(from 20deg, transparent, rgb(255 255 255 / 0.18) 12%, transparent 25%, rgb(255 200 150 / 0.16) 45%, transparent 60%, rgb(255 255 255 / 0.1) 80%, transparent)', animation: 'spin 40s linear infinite' }} />
        {photo && <img src={photo} alt="" className="absolute inset-[18%] h-[64%] w-[64%] rounded-full object-cover opacity-90 ring-2 ring-white/30" />}
      </div>
      {/* moon */}
      <div aria-hidden className="ambient absolute inset-[-22%]" style={{ animation: 'spin 18s linear infinite' }}>
        <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-[#ffe9cf] shadow-[0_0_10px_3px_rgba(255,220,180,0.6)]" />
      </div>
      <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">{t('you')}</div>
    </div>
  )
}

function SelectedCard({ p, now, onClose }: { p: Person; now: number; onClose: () => void }) {
  const nav = useNavigate()
  const reach = useReachOut()
  const w = warmthOf(p, now)
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 460, damping: 36 }}
      className="glass-strong fixed inset-x-4 bottom-[calc(96px+var(--safe-bottom))] z-30 mx-auto max-w-[460px] rounded-[28px] p-4 lg:bottom-8 lg:left-[calc(264px+1rem)]"
    >
      <div className="flex items-center gap-3.5">
        <Avatar person={p} size={56} warmth={w.level} ring />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold">{fullName(p)}</div>
          <div className="truncate text-[13px] text-fg-3">{jobLine(p) || p.city || CLOSENESS[p.closeness].name}</div>
          <div className="mt-1.5"><Pill color={WARMTH_COLORS[w.level]}>{WARMTH_LABEL[w.level]} · {ago(contactAnchor(p), now)}</Pill></div>
        </div>
        <button type="button" aria-label={t('Close')} onClick={onClose} className="press grid h-8 w-8 shrink-0 place-items-center self-start rounded-full bg-white/[0.08] text-fg-3"><XIcon size={14} weight="bold" /></button>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => reach(p)} className="press btn-primary h-11 flex-1 text-[15px]"><PaperPlaneTiltIcon size={17} weight="bold" />{' '}{t('Write')}</button>
        <button type="button" onClick={() => nav(`/person/${p.id}`)} className="press btn-glass h-11 flex-1">{t('Profile')}{' '}<ArrowRightIcon size={16} /></button>
      </div>
    </motion.div>
  )
}
