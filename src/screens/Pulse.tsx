import { motion } from 'motion/react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { Orb } from '@/components/Orb'
import { NetworkLinks, ReciprocityCard, RhythmSuggestions } from './pulse/Insights'
import { YearTeaser } from './pulse/YearTeaser'
import { Aurora } from '@/components/Aurora'
import { Empty, IconButton, PrimaryButton, SectionTitle } from '@/components/ui'
import { PulseIcon } from '@phosphor-icons/react'
import { useUI } from '@/app/store'
import { useAllInteractions, useCircles, useNow, usePeople } from '@/data/hooks'
import { CLOSENESS, healthLabel, networkHealth, warmthOf } from '@/data/logic'
import { CONTACT_TYPES } from '@/data/actions'
import { PALETTES } from '@/lib/colors'
import { DAY, startOfDay } from '@/lib/format'
import { t, tn, intlTag } from '@/i18n'

export function Pulse() {
  const people = usePeople()
  const ints = useAllInteractions()
  const circles = useCircles()
  const now = useNow()
  const nav = useNavigate()

  const data = useMemo(() => {
    const ps = people ?? []
    const contacts = ints.filter(i => CONTACT_TYPES.includes(i.type))
    const week = contacts.filter(i => now - i.date < 7 * DAY).length
    const weekAvg = contacts.filter(i => now - i.date < 84 * DAY).length / 12
    const newMonth = ps.filter(p => now - p.createdAt < 30 * DAY).length
    const newAvg = ps.filter(p => now - p.createdAt < 180 * DAY).length / 6
    const h = networkHealth(ps, now)
    const rhythmPct = h.tracked ? Math.round((h.inRhythm / h.tracked) * 100) : 0
    const inner = ps.filter(p => p.closeness === 1)
    const innerPct = inner.length ? Math.round((inner.filter(p => warmthOf(p, now).ratio <= 1).length / inner.length) * 100) : 0

    // тепловая карта: 18 недель
    const weeks = 18
    const today = startOfDay(now)
    const start = today - (weeks * 7 - 1) * DAY - new Date(today).getDay() * 0
    const cells = new Map<number, number>()
    for (const i of contacts) {
      const d = startOfDay(i.date)
      if (d >= start) cells.set(d, (cells.get(d) ?? 0) + i.personIds.length)
    }
    const grid = Array.from({ length: weeks * 7 }, (_, k) => {
      const d = start + k * DAY
      return { d, n: cells.get(d) ?? 0 }
    })

    const circleStats = circles.map(c => {
      const members = ps.filter(p => p.circleIds.includes(c.id))
      const ch = networkHealth(members, now)
      return { c, n: members.length, score: ch.score, tracked: ch.tracked }
    }).filter(x => x.n > 0)

    return { week, weekAvg, newMonth, newAvg, h, rhythmPct, innerPct, grid, circleStats, innerCount: inner.length }
  }, [people, ints, circles, now])

  const hl = healthLabel(data.h.score)
  const open = useUI(s => s.open)

  if (people && people.length === 0) {
    return (
      <Page>
        <div className="relative flex items-center justify-between pt-[calc(12px+var(--safe-top))]">
          <IconButton icon={ArrowLeftIcon} label={t('Back')} onClick={() => nav(-1)} size={42} />
          <span className="text-[16px] font-semibold">{t('Network pulse')}</span>
          <span className="w-[42px]" />
        </div>
        <div className="mt-10">
          <Empty icon={PulseIcon} title={t('Nothing to measure yet')} text={t('Add people and log interactions — network pulse, activity and the state of your circles will appear here.')} action={<PrimaryButton onClick={() => open({ kind: 'addPerson' })}>{t('Add a person')}</PrimaryButton>} />
        </div>
      </Page>
    )
  }

  return (
    <Page>
      <Aurora colors={['rgb(255 150 80 / 0.4)', 'rgb(124 92 255 / 0.35)', 'rgb(255 90 140 / 0.2)']} className="!bottom-auto h-[520px]"
        style={{ left: '-30vw', right: '-30vw', maskImage: 'linear-gradient(to bottom, #000 50%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 50%, transparent)' }} />
      <div className="relative flex items-center justify-between pt-[calc(12px+var(--safe-top))]">
        <IconButton icon={ArrowLeftIcon} label={t('Back')} onClick={() => nav(-1)} size={42} />
        <span className="text-[16px] font-semibold">{t('Network pulse')}</span>
        <span className="w-[42px]" />
      </div>

      <div className="relative mt-4 flex flex-col items-center text-center">
        <Orb value={data.h.score} tone={hl.tone} size={210} label={t('pulse')} />
        <div className="mt-1 text-[20px] font-semibold">{hl.title}</div>
        <p className="mt-1 max-w-[340px] text-[14px] leading-relaxed text-fg-3">
          {t('Pulse is how timely you keep up connections given their rhythm. The inner circle weighs more.')}
        </p>
      </div>

      <YearTeaser />

      <SectionTitle>{t('Today vs usual')}</SectionTitle>
      <div className="glass rows overflow-hidden rounded-[28px]">
        <MetricBar label={t('Contacts this week')} value={data.week} avg={data.weekAvg} max={Math.max(data.week, data.weekAvg * 2, 4)} unit="" />
        <MetricBar label={t('New acquaintances this month')} value={data.newMonth} avg={data.newAvg} max={Math.max(data.newMonth, data.newAvg * 2, 3)} unit="" />
        <MetricBar label={t('Connections on rhythm')} value={data.rhythmPct} avg={70} max={100} unit="%" avgLabel={t('goal')} />
        {data.innerCount > 0 && <MetricBar label={t('Inner circle on rhythm')} value={data.innerPct} avg={90} max={100} unit="%" avgLabel={t('goal')} />}
      </div>

      <SectionTitle>{t('Activity')}</SectionTitle>
      <div className="glass rounded-[28px] p-4">
        <div className="grid grid-flow-col grid-rows-7 gap-[4px]" style={{ gridAutoColumns: '1fr' }}>
          {data.grid.map(({ d, n }, i) => (
            <motion.div key={d} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.002 }}
              title={`${new Date(d).toLocaleDateString(intlTag())}: ${n}`}
              className="aspect-square rounded-[4px]"
              style={{
                background: n === 0 ? 'rgb(255 255 255 / 0.05)' : `rgb(255 ${Math.max(110, 200 - n * 30)} ${Math.max(60, 120 - n * 20)} / ${Math.min(0.35 + n * 0.22, 1)})`,
                boxShadow: n >= 2 ? '0 0 8px rgb(255 150 80 / 0.5)' : undefined,
              }} />
          ))}
        </div>
        <div className="mt-3 flex justify-between text-[12px] text-fg-4"><span>{t('18 weeks ago')}</span><span>{t('today')}</span></div>
      </div>

      {data.circleStats.length > 0 && (
        <>
          <SectionTitle>{t('Circles')}</SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {data.circleStats.map(({ c, n, score }) => {
              const st = score >= 70 ? { t: t('In shape'), col: '#5fe3b0', glow: 'rgb(60 200 150 / 0.35)' } : score >= 45 ? { t: t('Needs attention'), col: '#ffb36b', glow: 'rgb(255 150 80 / 0.35)' } : { t: t('Cooling'), col: '#8fb8ff', glow: 'rgb(90 140 255 / 0.35)' }
              return (
                <button key={c.id} type="button" onClick={() => nav('/people')} className="press glass glow-card flex items-center gap-3.5 rounded-[26px] p-4 text-left"
                  style={{ ['--glow' as string]: st.glow, ['--gx' as string]: '0%', ['--gy' as string]: '50%' }}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px]" style={{ background: `linear-gradient(135deg, ${PALETTES[c.palette].from}66, ${PALETTES[c.palette].to}22)` }}>{c.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold">{c.name}</span>
                    <span className="micro mt-1 block" style={{ color: st.col }}>{st.t}</span>
                  </span>
                  <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[12.5px] text-fg-2">{tn(n, '{n} ppl', '{n} ppl')} · {score}%</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      <RhythmSuggestions people={people ?? []} ints={ints} now={now} />
      <ReciprocityCard people={people ?? []} ints={ints} now={now} />
      <NetworkLinks />

      <SectionTitle>{t('Orbits')}</SectionTitle>
      <div className="glass rounded-[28px] p-5">
        {([1, 2, 3, 4] as const).map(c => {
          const n = (people ?? []).filter(p => p.closeness === c).length
          const max = Math.max(1, ...([1, 2, 3, 4] as const).map(k => (people ?? []).filter(p => p.closeness === k).length))
          return (
            <div key={c} className="mb-3.5 last:mb-0">
              <div className="mb-1.5 flex justify-between text-[14px]"><span>{CLOSENESS[c].name}</span><span className="tnum text-fg-3">{n}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div initial={{ width: 0 }} animate={{ width: `${(n / max) * 100}%` }} transition={{ duration: 1, delay: c * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full rounded-full" style={{ background: ['#ffb36b', '#ff7ab8', '#a796ff', '#74a6ff'][c - 1], boxShadow: `0 0 10px ${['#ffb36b', '#ff7ab8', '#a796ff', '#74a6ff'][c - 1]}` }} />
              </div>
            </div>
          )
        })}
      </div>
    </Page>
  )
}

/** Шкала со средним (Opal): заливка от среднего до значения — зелёная выше, красная ниже. */
function MetricBar({ label, value, avg, max, unit, avgLabel = t('usually') }: { label: string; value: number; avg: number; max: number; unit: string; avgLabel?: string }) {
  const up = value >= avg
  const pv = Math.min(value / max, 1) * 100
  const pa = Math.min(avg / max, 1) * 100
  const col = up ? '#5fe3b0' : '#ff6b7a'
  const diff = Math.round(Math.abs(value - avg) * 10) / 10
  return (
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[15.5px]">{label} <b className="tnum ml-1 font-semibold">{value}{unit}</b></span>
        <span className="text-[13px] font-semibold" style={{ color: col }}>{up ? '▲' : '▼'} {diff}{unit}</span>
      </div>
      <div className="relative mt-4 h-7">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: 'linear-gradient(90deg, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0.18), rgb(255 255 255 / 0.05))' }} />
        <motion.div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
          initial={{ left: `${pa}%`, width: 0 }}
          animate={{ left: `${Math.min(pa, pv)}%`, width: `${Math.abs(pv - pa)}%` }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          style={{ background: col, boxShadow: `0 0 10px ${col}` }} />
        <motion.span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink" initial={{ left: `${pa}%` }} animate={{ left: `${pv}%` }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} style={{ background: col }} />
        <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line-2 bg-ink-2 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-fg-2" style={{ left: `clamp(30px, ${pa}%, calc(100% - 30px))` }}>{avgLabel}</span>
      </div>
    </div>
  )
}
