import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRightIcon, GraphIcon, XIcon } from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { Avatar } from '@/components/Avatar'
import { OrbitSwitch } from '@/components/OrbitSwitch'
import { CountUp } from '@/components/CountUp'
import { Empty, Pill, PrimaryButton, SectionTitle } from '@/components/ui'
import { useAllInteractions, useCircles, useIntros, usePeople } from '@/data/hooks'
import { analyzeGraph, layoutGraph } from '@/data/graph'
import { PALETTES, PALETTE_KEYS } from '@/lib/colors'
import { fullName, jobLine } from '@/lib/format'
import { haptic } from '@/app/store'
import type { ID, Person } from '@/data/types'
import { t, tn } from '@/i18n'

const W = 360
const H = 440

/** Цвета групп берём из палитр кругов: один набор на всём приложении. */
const clusterColor = (i: number) => PALETTES[PALETTE_KEYS[i % PALETTE_KEYS.length]!]

export function Graph() {
  const people = usePeople()
  const ints = useAllInteractions()
  const intros = useIntros()
  const circles = useCircles()
  const nav = useNavigate()
  const [sel, setSel] = useState<ID | null>(null)
  const [focus, setFocus] = useState<number | null>(null)

  const g = useMemo(() => analyzeGraph(people ?? [], intros, ints, id => circles.find(c => c.id === id)?.name), [people, intros, ints, circles])
  const pos = useMemo(() => layoutGraph(g.connected.map(p => p.id), g.edges, g.clusterOf, W, H), [g])
  const byId = useMemo(() => new Map((people ?? []).map(p => [p.id, p])), [people])
  const bridgeIds = useMemo(() => new Set(g.bridges.slice(0, 6).map(b => b.person.id)), [g])

  const neighbors = useMemo(() => {
    const m = new Map<ID, Set<ID>>()
    for (const e of g.edges) {
      m.set(e.a, (m.get(e.a) ?? new Set()).add(e.b))
      m.set(e.b, (m.get(e.b) ?? new Set()).add(e.a))
    }
    return m
  }, [g])

  const auras = useMemo(() => g.clusters.filter(c => c.members.length > 1).map(c => {
    const pts = c.members.map(m => pos.get(m.id)).filter((p): p is { x: number; y: number } => !!p)
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const r = Math.max(...pts.map(p => Math.hypot(p.x - cx, p.y - cy))) + 34
    return { c, cx, cy, r }
  }), [g, pos])

  if (!people) return <Page><div /></Page>

  const selected = sel ? byId.get(sel) ?? null : null
  const lit = (id: ID) => {
    if (sel) return id === sel || neighbors.get(sel)?.has(id)
    if (focus !== null) return g.clusterOf.get(id) === focus
    return true
  }
  const edgeLit = (a: ID, b: ID) => (sel ? a === sel || b === sel : focus !== null ? g.clusterOf.get(a) === focus && g.clusterOf.get(b) === focus : true)

  const sparse = g.connected.length < 2

  return (
    <Page className="flex min-h-[100dvh] flex-col">
      <div className="relative z-10 pt-[calc(18px+var(--safe-top))]">
        <div className="micro text-fg-3">{t('who knows whom')}</div>
        <h1 className="mt-2 text-[34px] font-bold leading-none tracking-[-0.035em]">
          {t('Graph')}{' '}<span className="display text-[36px] font-normal text-fg-2">{t('of connections')}</span>
        </h1>
        <OrbitSwitch value="graph" />
      </div>

      {sparse ? (
        <div className="mt-8">
          <Empty icon={GraphIcon} title={t('No connections between people yet')}
            text={t('Mark in a profile who knows whom (“Connections”), or introduce two people — and groups and bridges between them will appear here.')}
            action={<PrimaryButton onClick={() => nav('/people')}>{t('To people')}</PrimaryButton>} />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <Stat n={g.edges.length} label={tn(g.edges.length, 'connection', 'connections')} />
            <Stat n={g.clusters.filter(c => c.members.length > 1).length} label={tn(g.clusters.filter(c => c.members.length > 1).length, 'group', 'groups')} />
            <Stat n={g.bridges.length} label={tn(g.bridges.length, 'bridge', 'bridges')} accent />
          </div>

          <div className="relative mt-4 overflow-hidden rounded-[30px] border border-line" style={{ background: 'radial-gradient(90% 70% at 50% 30%, rgb(124 92 255 / 0.10), transparent 70%), rgb(8 9 16 / 0.9)' }} onClick={() => { setSel(null); setFocus(null) }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto' }} role="img" aria-label={t('Graph of connections between people')}>
              <defs>
                {g.clusters.map(c => {
                  const col = clusterColor(c.id)
                  return (
                    <radialGradient key={c.id} id={`aura-${c.id}`}>
                      <stop offset="0%" stopColor={col.from} stopOpacity="0.30" />
                      <stop offset="65%" stopColor={col.from} stopOpacity="0.09" />
                      <stop offset="100%" stopColor={col.from} stopOpacity="0" />
                    </radialGradient>
                  )
                })}
                {g.clusters.map(c => (
                  <linearGradient key={`n-${c.id}`} id={`node-${c.id}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={clusterColor(c.id).to} />
                    <stop offset="100%" stopColor={clusterColor(c.id).from} />
                  </linearGradient>
                ))}
              </defs>

              {/* ауры групп */}
              {auras.map(({ c, cx, cy, r }) => (
                <motion.g key={`a-${c.id}`} initial={{ opacity: 0 }} animate={{ opacity: focus !== null && focus !== c.id ? 0.25 : 1 }} transition={{ duration: 0.6, delay: 0.1 }}>
                  <circle cx={cx} cy={cy} r={r} fill={`url(#aura-${c.id})`} />
                  <text x={cx} y={cy - r + 20} textAnchor="middle" fontSize="9" fontWeight="700" letterSpacing="1.2" fill={clusterColor(c.id).to} opacity="0.75" style={{ textTransform: 'uppercase' }}>{c.name.length > 18 ? `${c.name.slice(0, 17)}…` : c.name}</text>
                </motion.g>
              ))}

              {/* связи */}
              {g.edges.map((e, i) => {
                const A = pos.get(e.a); const B = pos.get(e.b)
                if (!A || !B) return null
                const on = edgeLit(e.a, e.b)
                const hot = sel && (e.a === sel || e.b === sel)
                const cross = g.clusterOf.get(e.a) !== g.clusterOf.get(e.b)
                return (
                  <motion.line key={`${e.a}-${e.b}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} strokeLinecap="round"
                    stroke={hot ? '#ffd9a8' : cross ? '#ffb36b' : '#ffffff'} strokeWidth={hot ? 1.8 : cross ? 1.2 : 0.9}
                    strokeDasharray={cross && !hot ? '3 3' : undefined}
                    initial={{ opacity: 0 }} animate={{ opacity: on ? (hot ? 0.95 : cross ? 0.5 : 0.18 + Math.min(e.w, 5) * 0.03) : 0.04 }} transition={{ duration: 0.5, delay: 0.25 + (i % 30) * 0.015 }} />
                )
              })}

              {/* люди */}
              {g.connected.map((p, i) => {
                const pt = pos.get(p.id)
                if (!pt) return null
                const deg = g.degree.get(p.id) ?? 0
                const isBridge = bridgeIds.has(p.id)
                const r = 8 + Math.min(deg, 6) * 1.2 + (isBridge ? 2.5 : 0)
                const cl = g.clusterOf.get(p.id) ?? 0
                const on = lit(p.id)
                const isSel = sel === p.id
                return (
                  <motion.g key={p.id} style={{ cursor: 'pointer', transformBox: 'fill-box', transformOrigin: 'center' }}
                    initial={{ scale: 0, opacity: 0 }} animate={{ scale: isSel ? 1.25 : 1, opacity: on ? 1 : 0.18 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 24, delay: isSel ? 0 : 0.12 + i * 0.018 }}
                    onClick={ev => { ev.stopPropagation(); haptic(8); setSel(isSel ? null : p.id) }}>
                    {isBridge && (
                      <circle className="pulse-ring ambient" cx={pt.x} cy={pt.y} r={r + 3} fill="none" stroke="#ffd9a8" strokeWidth="1.2" />
                    )}
                    <circle cx={pt.x} cy={pt.y} r={r} fill={`url(#node-${cl})`} stroke={isSel ? '#fff' : '#05060a'} strokeWidth={isSel ? 2 : 1.6} />
                    <text x={pt.x} y={pt.y + 3} textAnchor="middle" fontSize={Math.max(7.5, r * 0.78)} fontWeight="700" fill="#fff" style={{ pointerEvents: 'none' }}>{(p.firstName[0] ?? '') + (p.lastName?.[0] ?? '')}</text>
                    {(isBridge || isSel) && (
                      <text x={pt.x} y={pt.y + r + 11} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#f5f5fa" opacity="0.9" style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: '#05060a', strokeWidth: 3 }}>{p.firstName}</text>
                    )}
                  </motion.g>
                )
              })}
            </svg>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] text-fg-3">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#ffd9a8] shadow-[0_0_8px_#ffd9a8]" />{t('bridge between groups')}</span>
            <span className="flex items-center gap-1.5"><span className="h-px w-4 border-t border-dashed border-[#ffb36b]" />{t('connection between groups')}</span>
          </div>

          {/* группы */}
          <SectionTitle>{t('Groups')}</SectionTitle>
          <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
            {g.clusters.filter(c => c.members.length > 1).map(c => {
              const col = clusterColor(c.id)
              const on = focus === c.id
              return (
                <button key={c.id} type="button" onClick={() => { haptic(6); setSel(null); setFocus(on ? null : c.id) }} aria-pressed={on}
                  className={`press glass glow-card w-[168px] shrink-0 snap-start rounded-[24px] p-3.5 text-left transition-[border-color] ${on ? '!border-white/35' : ''}`}
                  style={{ ['--glow' as string]: col.glow, ['--gx' as string]: '10%', ['--gy' as string]: '0%' }}>
                  <div className="flex -space-x-2">
                    {c.members.slice(0, 4).map(m => <span key={m.id} className="rounded-full ring-2 ring-ink-2"><Avatar person={m} size={28} /></span>)}
                    {c.members.length > 4 && <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-2 text-[10.5px] font-semibold text-fg-2 ring-2 ring-ink-2">+{c.members.length - 4}</span>}
                  </div>
                  <div className="mt-3 truncate text-[15px] font-semibold">{c.name}</div>
                  <div className="text-[12.5px] text-fg-3">{tn(c.members.length, '{n} person', '{n} people')}</div>
                </button>
              )
            })}
          </div>

          {/* мосты */}
          {g.bridges.length > 0 && (
            <>
              <SectionTitle>{t('Bridges')}</SectionTitle>
              <p className="-mt-1 mb-3 px-1 text-[13.5px] leading-relaxed text-fg-3">{t('These people carry introductions between different worlds. Take care of such connections.')}</p>
              <div className="glass rows overflow-hidden rounded-[24px]">
                {g.bridges.slice(0, 5).map(b => {
                  const names = b.clusters.map(c => g.clusters.find(x => x.id === c)?.name).filter(Boolean)
                  return (
                    <Link key={b.person.id} to={`/person/${b.person.id}`} className="press flex items-center gap-3.5 px-4 py-3">
                      <Avatar person={b.person} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15.5px] font-medium">{fullName(b.person)}</div>
                        <div className="truncate text-[12.5px] text-fg-3">{t('Connects')}{' '}{names.slice(0, 3).map(n => `«${n}»`).join(t(' and '))}</div>
                      </div>
                      <Pill color="#ffd9a8">{tn(b.degree, '{n} connection', '{n} connections')}</Pill>
                    </Link>
                  )
                })}
              </div>
            </>
          )}

          {g.isolated.length > 0 && (
            <div className="mt-6 rounded-[22px] border border-dashed border-white/12 px-4 py-3.5">
              <div className="text-[14.5px] font-medium">{t('Without connections:')}{' '}<CountUp value={g.isolated.length} duration={0.8} /></div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{t("For these people it isn't marked who they know. Open a profile, “Connections” tab.")}</p>
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {g.isolated.slice(0, 12).map(p => <Link key={p.id} to={`/person/${p.id}?tab=links`} className="press shrink-0" aria-label={fullName(p)}><Avatar person={p} size={36} /></Link>)}
              </div>
            </div>
          )}
        </>
      )}

      <AnimatePresence>{selected && <Selected key={selected.id} p={selected} g={g} byId={byId} onClose={() => setSel(null)} />}</AnimatePresence>
    </Page>
  )
}

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="glass rounded-[22px] px-4 py-3.5">
      <CountUp value={n} className={`text-[28px] font-bold leading-none tracking-[-0.03em] ${accent ? 'text-[#ffd9a8]' : ''}`} />
      <div className="mt-1.5 text-[12.5px] text-fg-3">{label}</div>
    </div>
  )
}

function Selected({ p, g, byId, onClose }: { p: Person; g: ReturnType<typeof analyzeGraph>; byId: Map<ID, Person>; onClose: () => void }) {
  const nav = useNavigate()
  const known = g.edges.filter(e => e.a === p.id || e.b === p.id).map(e => byId.get(e.a === p.id ? e.b : e.a)).filter((x): x is Person => !!x)
  const bridge = g.bridges.find(b => b.person.id === p.id)
  const cl = g.clusters.find(c => c.id === g.clusterOf.get(p.id))
  return (
    <motion.div initial={{ opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 460, damping: 36 }}
      className="glass-strong fixed inset-x-4 bottom-[calc(96px+var(--safe-bottom))] z-30 mx-auto max-w-[460px] rounded-[28px] p-4 lg:bottom-8 lg:left-[calc(264px+1rem)]">
      <div className="flex items-center gap-3.5">
        <Avatar person={p} size={52} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold">{fullName(p)}</div>
          <div className="truncate text-[13px] text-fg-3">{jobLine(p) || cl?.name}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {cl && <Pill color={clusterColor(cl.id).to}>{cl.name}</Pill>}
            {bridge && <Pill color="#ffd9a8">{t('Bridge')}</Pill>}
          </div>
        </div>
        <button type="button" aria-label={t('Close')} onClick={onClose} className="press grid h-8 w-8 shrink-0 place-items-center self-start rounded-full bg-white/[0.08] text-fg-3"><XIcon size={14} weight="bold" /></button>
      </div>
      <p className="mt-3 text-[13.5px] leading-relaxed text-fg-2">
        {t('Knows')}{' '}{known.length ? known.slice(0, 4).map(k => k.firstName).join(', ') + (known.length > 4 ? t(' and {v} more', { v: known.length - 4 }) : '') : t('no one from your network')}.
        {bridge && t(' Connects different groups: introductions between them flow through this connection.')}
      </p>
      <button type="button" onClick={() => nav(`/person/${p.id}`)} className="press btn-glass mt-3 h-11 w-full">{t('Profile')}{' '}<ArrowRightIcon size={16} /></button>
    </motion.div>
  )
}
