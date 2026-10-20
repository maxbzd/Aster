import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon, ArrowsClockwiseIcon, CakeIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { Aurora } from '@/components/Aurora'
import { Avatar } from '@/components/Avatar'
import { AstraThinking, SourceBadge } from '@/components/astra/Astra'
import { Group, IconButton, SectionTitle } from '@/components/ui'
import { ReminderRow } from '@/components/Timeline'
import { astraWeekly } from '@/ai/astra'
import type { WeeklyData } from '@/ai/local/weekly'
import { useAstraStatus } from '@/ai/hooks'
import { usePeople } from '@/data/hooks'
import { dateShort, fullName, inDays } from '@/lib/format'
import { useUI } from '@/app/store'
import { t } from '@/i18n'

/** The weekly brief: a personal coach for your network. */
export function Weekly() {
  const nav = useNavigate()
  const open = useUI(s => s.open)
  const status = useAstraStatus()
  const people = usePeople()
  const [data, setData] = useState<WeeklyData | null>(null)

  const load = async (force = false) => { setData(null); setData(await astraWeekly(force)) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map((people ?? []).map(p => [p.id, p]))

  return (
    <Page>
      <Aurora colors={['rgb(255 170 100 / 0.45)', 'rgb(124 92 255 / 0.4)', 'rgb(255 100 150 / 0.25)']} className="!bottom-auto h-[560px]"
        style={{ left: '-30vw', right: '-30vw', maskImage: 'linear-gradient(to bottom, #000 50%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 50%, transparent)' }} />
      <div className="relative flex items-center justify-between pt-[calc(12px+var(--safe-top))]">
        <IconButton icon={ArrowLeftIcon} label={t('Back')} onClick={() => nav(-1)} size={42} />
        {status.connected && <IconButton icon={ArrowsClockwiseIcon} label={t('Rebuild')} onClick={() => load(true)} size={42} />}
      </div>

      {!data ? <AstraThinking kind="weekly" className="pt-32" /> : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative">
          <div className="mt-6 flex items-center justify-between">
            <span className="micro text-fg-3">{t('Weekly brief ·')}{' '}{data.range}</span>
            <SourceBadge source={data.source} />
          </div>
          <h1 className="display mt-4 text-[44px] leading-[1.02]">{data.headline}</h1>
          <p className="mt-4 text-[16.5px] leading-relaxed text-fg-2">{data.narrative}</p>

          <div className="mt-6 grid grid-cols-3 gap-2.5">
            <Stat value={String(data.stats.contacts)} label={t('contacts · usually {avg}', { avg: data.stats.avg })} up={data.stats.contacts >= data.stats.avg} />
            <Stat value={String(data.stats.newPeople)} label={t('new people')} />
            <Stat value={String(data.stats.health)} label={t('network pulse')} />
          </div>

          {data.priorities.length > 0 && (
            <>
              <SectionTitle>{t('Main things this week')}</SectionTitle>
              <div className="flex flex-col gap-2.5">
                {data.priorities.map((pr, i) => {
                  const p = byId.get(pr.personId)
                  if (!p) return null
                  return (
                    <div key={i} className="glass flex items-center gap-3.5 rounded-[24px] p-4">
                      <span className="display w-6 text-center text-[26px] text-fg-3">{i + 1}</span>
                      <Avatar person={p} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[15.5px] font-semibold leading-snug">{fullName(p)}</div>
                        <div className="mt-0.5 text-[13px] leading-snug"><span className="text-fg-2">{pr.action}</span><span className="text-fg-3"> · {pr.why}</span></div>
                      </div>
                      <button type="button" aria-label={t('Write')} onClick={() => open({ kind: 'draft', personId: p.id })} className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fg text-ink"><PaperPlaneTiltIcon size={17} weight="bold" /></button>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {data.birthdays.length > 0 && (
            <>
              <SectionTitle>{t('Birthdays')}</SectionTitle>
              <Group>
                {data.birthdays.map(({ p, b }) => (
                  <button key={p.id} type="button" onClick={() => nav(`/person/${p.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    <Avatar person={p} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">{fullName(p)}</span>
                      <span className="block text-[12.5px] text-fg-3">{inDays(b.days)} · {dateShort(b.date)}{b.turning ? t(' · turns {turning}', { turning: b.turning }) : ''}{p.giftIdeas ? ` · 🎁 ${p.giftIdeas}` : ''}</span>
                    </span>
                    <CakeIcon size={18} className="text-[#ff8fb8]" />
                  </button>
                ))}
              </Group>
            </>
          )}

          {data.cooling.length > 0 && (
            <>
              <SectionTitle>{t('Going cold')}</SectionTitle>
              <Group>
                {data.cooling.map(({ p, o, days }) => (
                  <button key={p.id} type="button" onClick={() => open({ kind: 'draft', personId: p.id, occasion: o ?? null })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    <Avatar person={p} size={40} warmth="cold" ring />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">{fullName(p)}</span>
                      <span className="block text-[12.5px] text-fg-3">{days}{' '}{t('days without contact')}{o && o.kind !== 'silence' ? t(' · reason: {detail}', { detail: o.detail }) : ''}</span>
                    </span>
                    <PaperPlaneTiltIcon size={17} className="text-fg-3" />
                  </button>
                ))}
              </Group>
            </>
          )}

          {data.intros.length > 0 && (
            <>
              <SectionTitle action={t('All')} onAction={() => nav('/intros')}>{t('Could be introduced')}</SectionTitle>
              <Group>
                {data.intros.map(m => (
                  <button key={`${m.a.id}${m.b.id}`} type="button" onClick={() => open({ kind: 'intro', aId: m.a.id, bId: m.b.id, reason: m.reason, value: m.value })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    <span className="flex -space-x-3"><Avatar person={m.a} size={36} /><Avatar person={m.b} size={36} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">{m.a.firstName} × {m.b.firstName}</span><span className="block truncate text-[12.5px] text-fg-3">{m.reason}</span></span>
                  </button>
                ))}
              </Group>
            </>
          )}

          {data.promises.length > 0 && (
            <>
              <SectionTitle>{t('Promises and to-dos')}</SectionTitle>
              <Group>{data.promises.map(r => <ReminderRow key={r.id} r={r} person={r.personId ? byId.get(r.personId) : undefined} />)}</Group>
            </>
          )}
        </motion.div>
      )}
    </Page>
  )
}

function Stat({ value, label, up }: { value: string; label: string; up?: boolean }) {
  return (
    <div className="glass rounded-[22px] p-3.5">
      <div className="tnum flex items-baseline gap-1 text-[26px] font-semibold tracking-[-0.03em]">{value}{up !== undefined && <span className={`text-[13px] ${up ? 'text-mint' : 'text-[#ff6b7a]'}`}>{up ? '▲' : '▼'}</span>}</div>
      <div className="mt-1 text-[12px] leading-tight text-fg-3">{label}</div>
    </div>
  )
}
