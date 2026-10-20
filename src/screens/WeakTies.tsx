import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PaperPlaneTiltIcon, SparkleIcon } from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { Avatar } from '@/components/Avatar'
import { OrbitSwitch } from '@/components/OrbitSwitch'
import { CountUp } from '@/components/CountUp'
import { Empty, PrimaryButton, SectionTitle } from '@/components/ui'
import { useAllInteractions, useCircles, useIntros, useNow, usePeople } from '@/data/hooks'
import { analyzeGraph } from '@/data/graph'
import { weakTies, type WeakTie } from '@/data/weak'
import { useReachOut } from '@/app/reach'
import { fullName, jobLine } from '@/lib/format'
import { t, tn } from '@/i18n'

export function WeakTies() {
  const people = usePeople()
  const ints = useAllInteractions()
  const intros = useIntros()
  const circles = useCircles()
  const now = useNow()
  const nav = useNavigate()
  const [more, setMore] = useState(false)

  const list = useMemo(() => {
    const ps = people ?? []
    const g = analyzeGraph(ps, intros, ints, id => circles.find(c => c.id === id)?.name)
    return weakTies(ps, ints, g, now)
  }, [people, ints, intros, circles, now])

  if (!people) return <Page><div /></Page>
  const top = list.slice(0, 3)
  const rest = list.slice(3, more ? 30 : 10)

  return (
    <Page>
      <div className="pt-[calc(18px+var(--safe-top))]">
        <div className="micro text-fg-3">{t('weak ties')}</div>
        <h1 className="mt-2 text-[34px] font-bold leading-none tracking-[-0.035em]">
          {t('Hidden')}{' '}<span className="display text-[36px] font-normal text-fg-2">{t('potential')}</span>
        </h1>
        <OrbitSwitch value="weak" />
      </div>

      <div className="relative mt-4 overflow-hidden rounded-[26px] border border-line p-4" style={{ background: 'linear-gradient(135deg, rgb(255 179 107 / 0.14), rgb(124 92 255 / 0.10))' }}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.08] text-[#ffd9a8]"><SparkleIcon size={20} weight="duotone" /></span>
          <p className="text-[14px] leading-relaxed text-fg-2">
            {t("Research shows: jobs, money and intros come more often from distant acquaintances than from close friends. They live in other worlds and know what you don't.")}
          </p>
        </div>
      </div>

      {people.length === 0 ? (
        <div className="mt-8"><Empty icon={SparkleIcon} title={t('No one yet')} text={t('Add people — distant acquaintances worth starting with will appear here.')} action={<PrimaryButton onClick={() => nav('/people')}>{t('To people')}</PrimaryButton>} /></div>
      ) : list.length === 0 ? (
        <div className="mt-8"><Empty icon={SparkleIcon} title={t('Nothing to suggest yet')} text={t('Give people a city, a role and how they can help, mark who knows whom — and distant acquaintances with potential will appear here.')} /></div>
      ) : (
        <>
          <SectionTitle count={list.length}>{t('Start with them')}</SectionTitle>
          <div className="flex flex-col gap-3">
            {top.map((top2, i) => <TopCard key={top2.person.id} t={top2} i={i} />)}
          </div>
          {rest.length > 0 && (
            <>
              <SectionTitle>{t('More')}</SectionTitle>
              <div className="glass rows overflow-hidden rounded-[24px]">
                {rest.map(rest2 => (
                  <Link key={rest2.person.id} to={`/person/${rest2.person.id}`} className="press flex items-center gap-3.5 px-4 py-3">
                    <Avatar person={rest2.person} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15.5px] font-medium">{fullName(rest2.person)}</div>
                      <div className="truncate text-[12.5px] text-fg-3">{rest2.reasons[0]}</div>
                    </div>
                    <span className="tnum text-[13px] font-semibold text-[#ffd9a8]">{rest2.score}</span>
                  </Link>
                ))}
              </div>
              {!more && list.length > 10 && <button type="button" onClick={() => setMore(true)} className="press mx-auto mt-3 block rounded-full border border-line px-4 py-2 text-[13.5px] text-fg-2">{tn(Math.min(20, list.length - 10), 'Show {n} more person', 'Show {n} more people')}</button>}
            </>
          )}
        </>
      )}
    </Page>
  )
}

function TopCard({ t: item, i }: { t: WeakTie; i: number }) {
  const reach = useReachOut()
  const nav = useNavigate()
  const p = item.person
  const C = 2 * Math.PI * 22
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.09, type: 'spring', stiffness: 320, damping: 30 }}
      className="glass glow-card rounded-[28px] p-4" style={{ ['--glow' as string]: i === 0 ? 'rgb(255 190 110 / 0.40)' : 'rgb(124 92 255 / 0.28)', ['--gx' as string]: '90%', ['--gy' as string]: '0%' }}>
      <div className="flex items-center gap-3.5">
        <Avatar person={p} size={54} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold">{fullName(p)}</div>
          <div className="truncate text-[13px] text-fg-3">{jobLine(p) || p.city || ' '}</div>
        </div>
        <div className="relative grid h-[54px] w-[54px] shrink-0 place-items-center">
          <svg width="54" height="54" viewBox="0 0 54 54" className="-rotate-90" aria-hidden="true">
            <circle cx="27" cy="27" r="22" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="4" />
            <motion.circle cx="27" cy="27" r="22" fill="none" stroke="#ffd9a8" strokeWidth="4" strokeLinecap="round" strokeDasharray={C}
              initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - item.score / 100) }} transition={{ duration: 1.1, delay: 0.3 + i * 0.1, ease: [0.22, 1, 0.36, 1] }} />
          </svg>
          <CountUp value={item.score} className="absolute text-[15px] font-bold" delay={0.3 + i * 0.1} />
        </div>
      </div>
      <ul className="mt-3.5 flex flex-col gap-1.5">
        {item.reasons.map(r => (
          <li key={r} className="flex items-start gap-2 text-[13.5px] leading-snug text-fg-2"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#ffd9a8]" />{r}</li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => reach(p)} className="press btn-primary h-11 flex-1 text-[15px]"><PaperPlaneTiltIcon size={17} weight="bold" />{' '}{t('Write')}</button>
        <button type="button" onClick={() => nav(`/person/${p.id}`)} className="press btn-glass h-11 px-5">{t('Profile')}</button>
      </div>
    </motion.div>
  )
}
