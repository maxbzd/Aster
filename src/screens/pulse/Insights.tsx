import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon, GraphIcon, SparkleIcon, TimerIcon } from '@phosphor-icons/react'
import { Avatar } from '@/components/Avatar'
import { SectionTitle } from '@/components/ui'
import { cadenceSuggestions, reciprocityRanking } from '@/data/history'
import { cadenceLabel } from '@/data/logic'
import { patchPerson } from '@/data/actions'
import { fullName } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import type { Interaction, Person } from '@/data/types'
import { t } from '@/i18n'

/** Smart rhythms: the app notices that you are not in touch as often as set and suggests adjusting the rhythm. */
export function RhythmSuggestions({ people, ints, now }: { people: Person[]; ints: Interaction[]; now: number }) {
  const toast = useUI(s => s.toast)
  const list = useMemo(() => cadenceSuggestions(people, ints, now).slice(0, 4), [people, ints, now])
  if (!list.length) return null
  const apply = async (p: Person, days: number) => {
    haptic(10)
    await patchPerson(p.id, { cadenceDays: days, cadenceHintDismissedAt: undefined })
    toast(t('Rhythm for {firstName}: {toLowerCase}', { firstName: p.firstName, toLowerCase: cadenceLabel(days).toLowerCase() }))
  }
  const keep = async (p: Person) => { haptic(6); await patchPerson(p.id, { cadenceHintDismissedAt: now }) }
  return (
    <>
      <SectionTitle count={list.length}>{t('Smart rhythms')}</SectionTitle>
      <p className="-mt-1 mb-3 px-1 text-[13.5px] leading-relaxed text-fg-3">{t("The rhythm is set one way, but you actually communicate differently. Adjust it to your life and you'll get exactly as many reminders as you need.")}</p>
      <div className="flex flex-col gap-2.5">
        <AnimatePresence initial={false}>
          {list.map(({ p, s }) => (
            <motion.div key={p.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginTop: -10 }} className="glass overflow-hidden rounded-[24px] p-4">
              <Link to={`/person/${p.id}`} className="flex items-center gap-3">
                <Avatar person={p} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15.5px] font-semibold">{fullName(p)}</div>
                  <div className="flex items-center gap-1.5 text-[12.5px] text-fg-3">
                    {cadenceLabel(s.current)} <ArrowRightIcon size={11} /> <b className="font-semibold text-fg-2">{cadenceLabel(s.suggested)}</b>
                  </div>
                </div>
                <TimerIcon size={20} className="text-fg-4" />
              </Link>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-fg-2">{s.message}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => apply(p, s.suggested)} className="press h-10 flex-1 rounded-full bg-fg text-[14px] font-semibold text-ink">{t('Set:')}{' '}{cadenceLabel(s.suggested).toLowerCase()}</button>
                <button type="button" onClick={() => keep(p)} className="press h-10 rounded-full border border-line px-4 text-[14px] text-fg-2">{t('Keep')}</button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  )
}

/** Reciprocity: who is lopsided, where you always write first, or the other way round. */
export function ReciprocityCard({ people, ints, now }: { people: Person[]; ints: Interaction[]; now: number }) {
  const list = useMemo(() => reciprocityRanking(people, ints, now).slice(0, 5), [people, ints, now])
  if (!list.length) return null
  return (
    <>
      <SectionTitle>{t('Reciprocity')}</SectionTitle>
      <p className="-mt-1 mb-3 px-1 text-[13.5px] leading-relaxed text-fg-3">{t("Who starts the conversation. A strong skew is a reason to wonder whether you're carrying the connection alone.")}</p>
      <div className="glass rows overflow-hidden rounded-[24px]">
        {list.map(({ p, r }) => {
          const meShare = r.me / (r.me + r.them)
          return (
            <Link key={p.id} to={`/person/${p.id}?tab=history`} className="press flex items-center gap-3.5 px-4 py-3.5">
              <Avatar person={p} size={42} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] font-medium">{fullName(p)}</span>
                  <span className="shrink-0 text-[12px] text-fg-3">{r.level === 'me' ? t('you') : t('they')} — {Math.round(Math.max(meShare, 1 - meShare) * 100)}%</span>
                </div>
                <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div className="h-full" initial={{ width: 0 }} animate={{ width: `${meShare * 100}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} style={{ background: '#8f7cff' }} />
                  <div className="h-full flex-1" style={{ background: '#ffb36b', opacity: 0.8 }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-fg-4"><span>{t('you ·')}{' '}{r.me}</span><span>{t('they ·')}{' '}{r.them}</span></div>
              </div>
            </Link>
          )
        })}
      </div>
    </>
  )
}

/** Two entrances to new views of the network. */
export function NetworkLinks() {
  const items = [
    { to: '/graph', icon: GraphIcon, title: t('Connection graph'), text: t('Who knows whom, groups and bridges'), color: '#8f7cff' },
    { to: '/weak', icon: SparkleIcon, title: t('Hidden potential'), text: t('Distant acquaintances to start with'), color: '#ffd9a8' },
  ]
  return (
    <>
      <SectionTitle>{t('Views of the network')}</SectionTitle>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {items.map(it => (
          <Link key={it.to} to={it.to} className="press glass glow-card flex items-center gap-3.5 rounded-[24px] p-4" style={{ ['--glow' as string]: `color-mix(in srgb, ${it.color} 30%, transparent)`, ['--gx' as string]: '0%', ['--gy' as string]: '50%' }}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[0.07]" style={{ color: it.color }}><it.icon size={22} weight="duotone" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-semibold">{it.title}</span>
              <span className="block text-[12.5px] text-fg-3">{it.text}</span>
            </span>
            <ArrowRightIcon size={16} className="text-fg-4" />
          </Link>
        ))}
      </div>
    </>
  )
}
