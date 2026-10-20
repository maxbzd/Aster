import { motion } from 'motion/react'
import { Link } from 'react-router'
import { Avatar } from '@/components/Avatar'
import { CountUp } from '@/components/CountUp'
import { monthName, type YearReview } from '@/data/year'
import { fullName } from '@/lib/format'
import type { Person } from '@/data/types'
import { t, tn, intlTag } from '@/i18n'
import { tx } from '@/i18n/react'

const EASE = [0.22, 1, 0.36, 1] as const

export interface SlideDef { key: string; colors: [string, string, string]; show: (r: YearReview) => boolean; render: (r: YearReview, ctx: SlideCtx) => React.ReactNode }
export interface SlideCtx { years: number[]; setYear: (y: number) => void; close: () => void; copy: () => void; copied: boolean }

/* ---------- shared building blocks ---------- */

const Kicker = ({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) => (
  <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.6, ease: EASE }} className="micro text-white/70">{children}</motion.div>
)

const Headline = ({ children, delay = 0.1, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) => (
  <motion.h2 initial={{ opacity: 0, y: 22, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay, duration: 0.8, ease: EASE }} className={`text-[30px] font-bold leading-[1.1] tracking-[-0.03em] ${className}`}>{children}</motion.h2>
)

const Note = ({ children, delay = 0.9 }: { children: React.ReactNode; delay?: number }) => (
  <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.7, ease: EASE }} className="mt-4 max-w-[330px] text-[16px] leading-relaxed text-white/75">{children}</motion.p>
)

/* ---------- 0. Intro ---------- */

export function IntroSlide({ r, ctx }: { r: YearReview; ctx: SlideCtx }) {
  const digits = String(r.year).split('')
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="relative grid h-[280px] w-[280px] place-items-center">
        <motion.svg viewBox="-140 -140 280 280" className="absolute inset-0" aria-hidden="true" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15, duration: 1.1, ease: EASE }}>
          {[140, 104, 70].map((R, i) => (
            <g key={R}>
              <circle r={R - 1} fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="1" />
              <g style={{ transformBox: 'view-box', transformOrigin: '50% 50%', animation: `${i % 2 ? 'spin-rev' : 'spin'} ${24 + i * 11}s steps(${(24 + i * 11) * 10}) infinite` }}>
                <circle cx="0" cy={-(R - 1)} r="11" fill="rgb(255 255 255 / 0.22)" />
                <circle cx="0" cy={-(R - 1)} r="5" fill="#fff" />
              </g>
            </g>
          ))}
        </motion.svg>
        <div className="relative flex text-[76px] font-extrabold leading-none tracking-[-0.05em]">
          {digits.map((d, i) => (
            <motion.span key={i} initial={{ opacity: 0, y: 60, rotateX: -60 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ delay: 0.3 + i * 0.1, type: 'spring', stiffness: 180, damping: 16 }}>{d}</motion.span>
          ))}
        </div>
      </div>
      <Kicker delay={0.9}>{t('your year in people')}</Kicker>
      <Headline delay={1.0} className="mt-3 max-w-[320px]"><span className="display text-[36px] font-medium">{r.title}</span></Headline>
      <Note delay={1.3}>{r.subtitle}</Note>
      {ctx.years.length > 1 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }} className="mt-7 flex flex-wrap justify-center gap-2" data-nav-ignore>
          {ctx.years.slice(0, 5).map(y => (
            <button key={y} type="button" onClick={() => ctx.setYear(y)} className={`press h-9 rounded-full px-4 text-[14px] font-semibold ${y === r.year ? 'bg-white text-ink' : 'border border-white/25 text-white/80'}`}>{y}</button>
          ))}
        </motion.div>
      )}
    </div>
  )
}

/* ---------- 1. Total contact ---------- */

export function TotalSlide({ r }: { r: YearReview }) {
  const rings = [
    { label: t('Meetings'), n: r.meetings + r.events, color: '#ffb36b', radius: 98 },
    { label: t('Calls'), n: r.calls, color: '#7fd6ff', radius: 78 },
    { label: t('Messages'), n: r.messages, color: '#c3b4ff', radius: 58 },
  ]
  const max = Math.max(1, ...rings.map(x => x.n))
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Kicker>{t('total for the year')}</Kicker>
      <div className="relative mt-4 grid h-[260px] w-[260px] place-items-center">
        <svg viewBox="0 0 260 260" className="absolute inset-0 -rotate-90" aria-hidden="true">
          {rings.map((x, i) => {
            const C = 2 * Math.PI * x.radius
            const sweep = 0.75 * (x.n / max)
            return (
              <g key={x.label}>
                <circle cx="130" cy="130" r={x.radius} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="11" strokeDasharray={`${C * 0.75} ${C}`} strokeLinecap="round" />
                <motion.circle cx="130" cy="130" r={x.radius} fill="none" stroke={x.color} strokeWidth="11" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 8px ${x.color})` }}
                  initial={{ strokeDasharray: `0 ${C}` }} animate={{ strokeDasharray: `${C * sweep} ${C}` }} transition={{ delay: 0.4 + i * 0.2, duration: 1.4, ease: EASE }} />
              </g>
            )
          })}
        </svg>
        <div className="relative">
          <CountUp value={r.total} duration={1.6} delay={0.3} className="text-[64px] font-extrabold leading-none tracking-[-0.05em]" />
          <div className="mt-1 text-[13px] text-white/70">{tn(r.total, 'contact', 'contacts')}</div>
        </div>
      </div>
      <div className="mt-6 flex gap-5">
        {rings.map((x, i) => (
          <motion.div key={x.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 + i * 0.12 }} className="text-left">
            <div className="flex items-center gap-1.5 text-[12px] text-white/70"><span className="h-2 w-2 rounded-full" style={{ background: x.color, boxShadow: `0 0 8px ${x.color}` }} />{x.label}</div>
            <div className="tnum text-[26px] font-bold leading-tight">{x.n}</div>
          </motion.div>
        ))}
      </div>
      <Note delay={1.5}>
        {tn(r.uniquePeople, 'With {n} person.', 'With {n} people.')}
        {r.deltaPct !== null && (r.deltaPct > 300 ? t(" That's {round} {plural} more than last year.", { round: Math.round(r.deltaPct / 100 + 1), plural: tn(Math.round(r.deltaPct / 100 + 1), 'time', 'times') }) : r.deltaPct >= 0 ? t(" That's {deltaPct}% more than last year.", { deltaPct: r.deltaPct }) : t(" That's {abs}% less than last year.", { abs: Math.abs(r.deltaPct) }))}
        {r.partial && t(" The year isn't over yet.")}
      </Note>
    </div>
  )
}

/* ---------- 2. By month ---------- */

export function MonthsSlide({ r }: { r: YearReview }) {
  const max = Math.max(1, ...r.monthly)
  return (
    <div className="flex h-full flex-col justify-center">
      <Kicker>{t('rhythm of the year')}</Kicker>
      <Headline className="mt-2">{r.busiestMonth ? <>{t('The liveliest was')}{' '}<span className="display text-[34px] font-medium">{r.busiestMonth.name}</span></> : t('Month by month')}</Headline>
      <div className="mt-10 flex h-[230px] items-end gap-[6px]">
        {r.monthly.map((n, i) => {
          const top = r.busiestMonth?.index === i
          return (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
              {top && <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.6 }} className="tnum text-[13px] font-bold text-[#ffd9a8]">{n}</motion.span>}
              <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(4, (n / max) * 100) * 0.82}%` }} transition={{ delay: 0.3 + i * 0.07, type: 'spring', stiffness: 120, damping: 16 }}
                className="w-full rounded-t-[10px]" style={{ background: top ? 'linear-gradient(180deg, #ffe4b8, #ff9d4d)' : 'linear-gradient(180deg, rgb(255 255 255 / 0.85), rgb(255 255 255 / 0.25))', boxShadow: top ? '0 0 30px rgb(255 170 80 / 0.7)' : undefined, opacity: n === 0 ? 0.25 : 1 }} />
              <span className="text-[10.5px] font-semibold uppercase text-white/55">{monthName(i).slice(0, 1)}</span>
            </div>
          )
        })}
      </div>
      <Note delay={1.5}>
        {r.weekStreak >= 3 ? tn(r.weekStreak, 'Longest streak: {n} week in a row with active communication.', 'Longest streak: {n} weeks in a row with active communication.') : t('Each bar is a month of your communication.')}
      </Note>
    </div>
  )
}

/* ---------- 3. New people ---------- */

export function NewPeopleSlide({ r }: { r: YearReview }) {
  const list = r.newPeople.slice(0, 22)
  const n = list.length
  const size = n <= 5 ? 60 : n <= 10 ? 48 : n <= 16 ? 40 : 34
  const c = size * 1.0
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Kicker>{t('new faces')}</Kicker>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-[56px] font-extrabold text-white/60">+</span>
        <CountUp value={r.newPeople.length} duration={1.4} className="text-[104px] font-extrabold leading-none tracking-[-0.06em]" />
      </div>
      <Headline delay={0.5}>{tn(r.newPeople.length, 'new person', 'new people')}{' '}{t('in your network')}</Headline>
      <div className="relative mt-6 h-[250px] w-full max-w-[340px]">
        {list.map((p, i) => {
          // a spiral with the golden angle: avatars lie densely and do not overlap
          const a = i * 2.39996
          const rad = c * Math.sqrt(i + 0.5)
          return (
            <motion.div key={p.id} className="absolute" style={{ left: `calc(50% + ${Math.cos(a) * rad}px - ${size / 2}px)`, top: `calc(50% + ${Math.sin(a) * rad * 0.78}px - ${size / 2}px)` }}
              initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.7 + i * 0.07, type: 'spring', stiffness: 260, damping: 14 }}>
              <Avatar person={p} size={size} />
            </motion.div>
          )
        })}
      </div>
      <Note delay={2}>{r.newPeople.length > 22 ? t('…and {v} more. ', { v: r.newPeople.length - 22 }) : ''}{t('Each of them was once just an unfamiliar name.')}</Note>
    </div>
  )
}

/* ---------- 4. The main person ---------- */

export function TopPersonSlide({ r }: { r: YearReview }) {
  const [top, ...rest] = r.topPeople
  if (!top) return null
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Kicker>{t('most interaction')}</Kicker>
      <div className="relative mt-8 grid h-[210px] w-[210px] place-items-center">
        {[0, 1, 2].map(i => (
          <motion.span key={i} aria-hidden className="absolute rounded-full border border-white/30" initial={{ width: 160, height: 160, opacity: 0.6 }} animate={{ width: 280, height: 280, opacity: 0 }}
            transition={{ repeat: Infinity, duration: 3.2, delay: 0.8 + i * 1.05, ease: 'easeOut' }} />
        ))}
        <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.3, type: 'spring', stiffness: 150, damping: 12 }} style={{ filter: 'drop-shadow(0 0 40px rgb(255 140 160 / 0.7))' }}>
          <Avatar person={top.person} size={160} />
        </motion.div>
      </div>
      <Headline delay={0.9} className="mt-6">{fullName(top.person)}</Headline>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="mt-2 text-[17px] text-white/80">
        <CountUp value={top.count} duration={1.2} delay={1.1} className="font-bold" /> {tn(top.count, 'time', 'times')}{' '}{t('in touch')}
      </motion.div>
      {rest.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.6 }} className="mt-8 flex gap-3">
          {rest.slice(0, 3).map((x, i) => (
            <Link key={x.person.id} to={`/person/${x.person.id}`} className="press flex w-[92px] flex-col items-center gap-1.5 rounded-[20px] bg-white/[0.08] px-2 py-3">
              <Avatar person={x.person} size={42} />
              <span className="w-full truncate text-[12.5px] font-medium">{x.person.firstName}</span>
              <span className="tnum text-[11.5px] text-white/60">{t('{rank} · {count}', { rank: i + 2, count: x.count })}</span>
            </Link>
          ))}
        </motion.div>
      )}
    </div>
  )
}

/* ---------- 5. Cities ---------- */

export function CitiesSlide({ r }: { r: YearReview }) {
  const max = Math.max(1, ...r.cities.map(c => c.count))
  return (
    <div className="flex h-full flex-col justify-center">
      <Kicker>{t('geography')}</Kicker>
      <Headline className="mt-2">{t('Meetings in')}{' '}<span className="display text-[34px] font-medium">{r.cities.length} {tn(r.cities.length, 'city', 'cities')}</span></Headline>
      <div className="mt-8 flex flex-col gap-4">
        {r.cities.map((c, i) => (
          <div key={c.city}>
            <div className="mb-1.5 flex items-baseline justify-between text-[16px]">
              <motion.span initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.12 }} className={i === 0 ? 'font-bold' : 'font-medium text-white/85'}>{i === 0 ? '📍 ' : ''}{c.city}</motion.span>
              <span className="tnum text-[13px] text-white/60">{c.count}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
              <motion.div initial={{ width: 0 }} animate={{ width: `${(c.count / max) * 100}%` }} transition={{ delay: 0.4 + i * 0.12, duration: 1.1, ease: EASE }}
                className="h-full rounded-full" style={{ background: i === 0 ? 'linear-gradient(90deg, #ffd9a8, #ff7ae0)' : 'linear-gradient(90deg, rgb(255 255 255 / 0.7), rgb(255 255 255 / 0.35))', boxShadow: i === 0 ? '0 0 18px rgb(255 140 220 / 0.7)' : undefined }} />
            </div>
          </div>
        ))}
      </div>
      <Note delay={1.5}>{t('Cities are counted by people you met in person.')}</Note>
    </div>
  )
}

/* ---------- 6. The warmest ---------- */

export function WarmestSlide({ r }: { r: YearReview }) {
  const order = [r.warmest[1], r.warmest[0], r.warmest[2]]
  const heights = [96, 140, 76]
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Kicker>{t('warmest connections')}</Kicker>
      <Headline className="mt-2">{t('These people warmed the whole year')}</Headline>
      <div className="mt-10 flex items-end justify-center gap-3">
        {order.map((w, i) => w && (
          <Link key={w.person.id} to={`/person/${w.person.id}`} className="press flex w-[100px] flex-col items-center">
            <motion.div initial={{ opacity: 0, y: 30, scale: 0.6 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.5 + i * 0.18, type: 'spring', stiffness: 200, damping: 14 }} style={{ filter: i === 1 ? 'drop-shadow(0 0 26px rgb(255 190 90 / 0.9))' : 'drop-shadow(0 0 14px rgb(255 160 80 / 0.5))' }}>
              <Avatar person={w.person} size={i === 1 ? 78 : 62} />
            </motion.div>
            <div className="mt-2 w-full truncate text-[14px] font-semibold">{w.person.firstName}</div>
            <motion.div initial={{ height: 0 }} animate={{ height: heights[i] }} transition={{ delay: 0.3 + i * 0.12, type: 'spring', stiffness: 90, damping: 15 }}
              className="mt-2 grid w-full place-items-start justify-center rounded-t-[18px] pt-3" style={{ background: i === 1 ? 'linear-gradient(180deg, #ffd9a8, #ff8a4d)' : 'linear-gradient(180deg, rgb(255 217 168 / 0.55), rgb(255 138 77 / 0.25))' }}>
              <CountUp value={w.score} delay={0.9 + i * 0.1} className={`text-[24px] font-extrabold ${i === 1 ? 'text-[#4a1c00]' : 'text-white'}`} />
            </motion.div>
          </Link>
        ))}
      </div>
      <Note delay={1.6}>{t('The number is the average connection “temperature” over the year: the closer to a hundred, the warmer you were.')}</Note>
    </div>
  )
}

/* ---------- 7. Reciprocity ---------- */

export function ReciprocitySlide({ r }: { r: YearReview }) {
  const { me, them, both } = r.reciprocity
  const known = me + them
  const meShare = known ? me / known : 0.5
  return (
    <div className="flex h-full flex-col justify-center">
      <Kicker>{t('who makes the first move')}</Kicker>
      <Headline className="mt-2">{r.reciprocity.level === 'balanced' ? t('Initiative is even') : r.reciprocity.level === 'me' ? tx('Started more often by {who}', { who: <span className="display text-[34px] font-medium">{t('you')}</span> }) : tx('Started more often by {who}', { who: <span className="display text-[34px] font-medium">{t('they')}</span> }, 'them')}</Headline>
      <div className="mt-12">
        <div className="flex h-12 overflow-hidden rounded-full bg-white/10">
          <motion.div initial={{ width: '0%' }} animate={{ width: `${meShare * 100}%` }} transition={{ delay: 0.5, duration: 1.4, ease: EASE }} className="grid place-items-center text-[15px] font-bold" style={{ background: 'linear-gradient(90deg, #8f7cff, #c3b4ff)', boxShadow: '0 0 30px rgb(143 124 255 / 0.6)' }}>
            {meShare > 0.18 && <CountUp value={me} delay={0.9} />}
          </motion.div>
          <div className="grid flex-1 place-items-center text-[15px] font-bold text-[#3a1c00]" style={{ background: 'linear-gradient(90deg, #ffd9a8, #ffb36b)' }}>
            {meShare < 0.82 && <CountUp value={them} delay={0.9} />}
          </div>
        </div>
        <div className="mt-2.5 flex justify-between text-[13px] text-white/70"><span>{t('You first')}</span><span>{t('They did')}</span></div>
      </div>
      <Note delay={1.5}>{both > 0 ? t('Another {both} times you started together. ', { both }) : ''}{r.reciprocity.level === 'me' ? t("That's normal, but check: aren't you carrying someone alone?") : r.reciprocity.level === 'them' ? t("People reach out to you. Reply to those who've been waiting.") : t('A good sign: connections are held up from both sides.')}</Note>
    </div>
  )
}

/* ---------- 8. Who you drifted from ---------- */

export function LostSlide({ r }: { r: YearReview }) {
  return (
    <div className="flex h-full flex-col justify-center">
      <Kicker>{t('quietly drifted away')}</Kicker>
      <Headline className="mt-2">{t('Who got')}{' '}<span className="display text-[34px] font-medium">{t('quieter')}</span></Headline>
      <Note delay={0.5}>{t('Not a loss, but a reason. Sometimes one message brings everything back.')}</Note>
      <div className="mt-6 flex flex-col gap-2.5">
        {r.lost.map((x, i) => (
          <motion.div key={x.person.id} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 + i * 0.14, duration: 0.7, ease: EASE }}>
            <Link to={`/person/${x.person.id}`} className="press flex items-center gap-3.5 rounded-[22px] bg-white/[0.07] px-3.5 py-3">
              <span style={{ filter: 'saturate(0.4) brightness(0.9)' }}><Avatar person={x.person} size={44} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{fullName(x.person)}</span>
                <span className="block text-[12.5px] text-white/60">{x.reason === 'status' ? t('Connection marked as lost') : x.lastAt ? t('Last time — {toLocaleDateString}', { toLocaleDateString: new Date(x.lastAt).toLocaleDateString(intlTag(), { month: 'long', year: 'numeric' }) }) : t('Longest since contact')}</span>
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/* ---------- 9. Summary ---------- */

export function SummarySlide({ r, ctx }: { r: YearReview; ctx: SlideCtx }) {
  const cells: Array<[string, number]> = [
    [t('contacts'), r.total], [t('meetings'), r.meetings + r.events], [t('calls'), r.calls], [t('new people'), r.newPeople.length],
  ]
  const top = r.topPeople[0]?.person
  const warm: Person | undefined = r.warmest[0]?.person
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <motion.div initial={{ opacity: 0, y: 40, rotate: -2, scale: 0.94 }} animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 120, damping: 16 }}
        className="relative w-full max-w-[340px] overflow-hidden rounded-[34px] p-6" style={{ background: 'linear-gradient(150deg, rgb(255 255 255 / 0.2), rgb(255 255 255 / 0.06) 50%, rgb(255 255 255 / 0.14))', border: '1px solid rgb(255 255 255 / 0.28)', boxShadow: '0 40px 90px -30px rgb(0 0 0 / 0.8)' }}>
        <div aria-hidden className="absolute -right-16 -top-16 h-52 w-52 rounded-full" style={{ background: 'radial-gradient(closest-side, rgb(255 190 120 / 0.55), transparent)' }} />
        <div className="relative">
          <div className="flex items-baseline justify-between">
            <span className="micro text-white/70">{t('Aster · year in review')}</span>
            <span className="text-[34px] font-extrabold leading-none tracking-[-0.04em]">{r.year}</span>
          </div>
          <div className="display mt-4 text-[27px] font-medium leading-tight">{r.title}</div>
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            {cells.map(([label, n], i) => (
              <motion.div key={label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.09 }} className="rounded-[18px] bg-black/25 px-3.5 py-3">
                <CountUp value={n} delay={0.5 + i * 0.09} duration={1.1} className="text-[28px] font-extrabold leading-none tracking-[-0.03em]" />
                <div className="mt-1 text-[12px] text-white/65">{label}</div>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2.5 text-[14px]">
            {top && <Row label={t('Top person')} person={top} />}
            {warm && <Row label={t('Warmest')} person={warm} />}
            {r.cities[0] && <div className="flex items-center justify-between rounded-[16px] bg-black/20 px-3.5 py-2.5"><span className="text-white/65">{t('Top city')}</span><span className="font-semibold">📍 {r.cities[0].city}</span></div>}
          </div>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="mt-6 flex w-full max-w-[340px] gap-2.5" data-nav-ignore>
        <button type="button" onClick={ctx.copy} className="press h-12 flex-1 rounded-full bg-white text-[15px] font-semibold text-ink">{ctx.copied ? t('Copied ✓') : t('Copy summary')}</button>
        <button type="button" onClick={ctx.close} className="press h-12 rounded-full border border-white/30 px-6 text-[15px] font-medium">{t('Close')}</button>
      </motion.div>
    </div>
  )
}

function Row({ label, person }: { label: string; person: Person }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-black/20 px-3.5 py-2.5">
      <span className="text-white/65">{label}</span>
      <span className="flex shrink-0 items-center gap-2 font-semibold"><Avatar person={person} size={22} />{person.firstName}</span>
    </div>
  )
}
