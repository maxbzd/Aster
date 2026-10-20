import { motion } from 'motion/react'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  CakeIcon, CalendarStarIcon, CardsThreeIcon, ChatCircleDotsIcon, CheckIcon, ClockCountdownIcon, CloudArrowDownIcon, FileTextIcon,
  MagnifyingGlassIcon, MicrophoneIcon, PaperPlaneTiltIcon, SparkleIcon, UserCirclePlusIcon, XIcon,
} from '@phosphor-icons/react'
import { AstraStar, astraGlow } from '@/components/astra/Astra'
import { useLocalMatches, useOccasions } from '@/ai/hooks'
import { OCCASION_META, type Occasion } from '@/ai/local/occasions'
import type { MatchPair } from '@/ai/local/matches'
import { Page } from '@/components/Page'
import { Aurora } from '@/components/Aurora'
import { Orb } from '@/components/Orb'
import { Avatar } from '@/components/Avatar'
import { Logo } from '@/components/Nav'
import { Group, IconButton, Pill, PrimaryButton, SectionTitle, Empty, stagger } from '@/components/ui'
import { ReminderRow, Timeline } from '@/components/Timeline'
import { useAllPeople, useCircles, useNow, usePeople, useRecentInteractions, useReminders, useSettings } from '@/data/hooks'
import {
  coolingClose, dueContacts, healthLabel, networkHealth, personOfTheDay, warmthOf, WARMTH_LABEL, contactAnchor } from '@/data/logic'
import { WARMTH_COLORS } from '@/lib/colors'
import { ago, dateLong, daysBetween, greeting, jobLine, weekday, dateShort } from '@/lib/format'
import { backupToFile, saveSettings, snooze } from '@/data/actions'
import { useQuickLog } from '@/app/reach'
import { useUI } from '@/app/store'
import { OrbitaSuggestionsCard } from '@/bridge/Bits'
import { useCloud } from '@/cloud/store'
import { upcomingDates } from '@/data/dates'
import type { Person } from '@/data/types'
import { t, tn } from '@/i18n'

const TONE_AURORA = {
  hot: ['rgb(255 140 70 / 0.55)', 'rgb(255 90 120 / 0.35)', 'rgb(124 92 255 / 0.35)'],
  warm: ['rgb(255 190 110 / 0.45)', 'rgb(124 92 255 / 0.40)', 'rgb(255 110 150 / 0.25)'],
  cooling: ['rgb(124 92 255 / 0.55)', 'rgb(70 130 255 / 0.35)', 'rgb(255 120 180 / 0.25)'],
  cold: ['rgb(60 110 255 / 0.5)', 'rgb(124 92 255 / 0.35)', 'rgb(80 200 255 / 0.25)'],
}

export function Today() {
  const now = useNow()
  const people = usePeople()
  const settings = useSettings()
  const reminders = useReminders()
  const recent = useRecentInteractions(6)
  const circles = useCircles()
  const nav = useNavigate()
  const open = useUI(s => s.open)
  const setSearch = useUI(s => s.setSearch)
  const { list: occasions, byPerson: occByPerson } = useOccasions()
  const matches = useLocalMatches()

  const byId = useMemo(() => new Map((people ?? []).map(p => [p.id, p])), [people])
  const health = useMemo(() => networkHealth(people ?? [], now), [people, now])
  const hl = healthLabel(health.score)
  const due = useMemo(() => dueContacts(people ?? [], now), [people, now])
  const everyone = useAllPeople()
  // birthdays (family's included) and important dates: anniversaries, name days, jubilees
  const dates = useMemo(() => upcomingDates(everyone ?? [], 30, now), [everyone, now])
  const potd = useMemo(() => personOfTheDay((people ?? []).filter(p => !due.slice(0, 3).some(d => d.p.id === p.id)), now), [people, due, now])
  const toast = useUI(s => s.toast)
  const cloudOn = useCloud(c => !!c.userId)
  const needsBackup = !cloudOn && !!settings && (people?.length ?? 0) >= 8 && now - settings.createdAt > 2 * 86400000 && now > (settings.backupSnoozeUntil ?? 0) && now - (settings.lastBackupAt ?? 0) > 30 * 86400000
  const openReminders = reminders.filter(r => !r.done && daysBetween(now, r.dueAt) <= 7)
  const contacts30 = useMemo(
    () => (people ?? []).filter(p => p.lastContactAt && now - p.lastContactAt < 30 * 86400000).length,
    [people, now],
  )

  if (!people) return <Page><div /></Page>
  const empty = people.length === 0
  const first = settings?.name?.split(' ')[0] || t('friend')

  return (
    <Page>
      <Aurora colors={TONE_AURORA[hl.tone]} className="!bottom-auto h-[680px]" intensity={0.9}
        style={{ left: '-30vw', right: '-30vw', maskImage: 'linear-gradient(to bottom, #000 55%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent)' }} />

      <div className="relative flex items-center justify-between pt-[calc(14px+var(--safe-top))]">
        <div className="lg:invisible"><Logo size={20} /></div>
        <div className="flex items-center gap-2">
          <IconButton icon={MagnifyingGlassIcon} label={t('Search')} onClick={() => setSearch(true)} size={40} />
          <Link to="/me" className="press">
            {settings && <Avatar person={{ id: 'me', firstName: settings.name || t('Me'), photo: settings.photo }} size={40} />}
          </Link>
        </div>
      </div>

      <motion.section variants={stagger.container} initial="hidden" animate="show" className="relative">
        <motion.div variants={stagger.item} className="mt-7 px-1">
          <div className="micro text-fg-3">{weekday(now)} · {dateLong(now, false)}</div>
          <h1 className="mt-3 text-[30px] font-semibold leading-[1.05] tracking-[-0.03em]">
            {greeting()},<br />
            <span className="display text-[50px] leading-[1.1] tracking-[-0.02em]">{first}</span>
          </h1>
        </motion.div>

        {empty ? (
          <motion.div variants={stagger.item} className="mt-10">
            <Empty
              icon={UserCirclePlusIcon}
              title={t('Your universe is empty for now')}
              text={t("Add the first person — someone you recently met or don't want to lose.")}
              action={<PrimaryButton onClick={() => open({ kind: 'addPerson' })}>{t('Add a person')}</PrimaryButton>}
            />
          </motion.div>
        ) : (
          <>
            {/* Network pulse */}
            <motion.button variants={stagger.item} type="button" onClick={() => nav('/pulse')} className="press mx-auto mt-4 flex w-full flex-col items-center">
              <Orb value={health.score} tone={hl.tone} size={236} label={t('network pulse')} />
              <div className="-mt-1 text-center">
                <div className="text-[19px] font-semibold tracking-[-0.01em]">{hl.title}</div>
                <div className="mt-1 text-[14px] text-fg-3">{tn(health.tracked, '{inRhythm} of {n} connection on rhythm', '{inRhythm} of {n} connections on rhythm', { inRhythm: health.inRhythm })}</div>
              </div>
            </motion.button>

            <motion.div variants={stagger.item} className="mt-7 grid grid-cols-3 gap-2.5">
              <StatTile icon={ChatCircleDotsIcon} value={due.length} label={t('waiting for contact')} color={WARMTH_COLORS.cooling} onClick={() => nav('/review')} />
              <StatTile icon={CakeIcon} value={dates.length} label={dates.length === 1 ? t('date this month') : t('dates this month')} color="#ff8fb8" onClick={() => document.getElementById('bdays')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
              <StatTile icon={SparkleIcon} value={contacts30} label={t('contacts this month')} color={WARMTH_COLORS.hot} onClick={() => nav('/pulse')} />
            </motion.div>

            {needsBackup && (
              <motion.div variants={stagger.item} className="glass mt-5 flex items-center gap-3 rounded-[22px] py-3 pl-4 pr-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warm/15 text-warm"><CloudArrowDownIcon size={18} /></span>
                <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-fg-2">{settings?.lastBackupAt ? t('Your backup is out of date.') : t('Your data lives only on this device.')}{' '}{t('Save a copy — it takes 5 seconds.')}</span>
                <button type="button" onClick={async () => { await backupToFile(); toast(t('Backup saved')) }} className="press hit rounded-full bg-fg px-3.5 py-2 text-[13px] font-semibold text-ink">{t('Download')}</button>
                <button type="button" aria-label={t('Remind me later')} onClick={() => saveSettings({ backupSnoozeUntil: Date.now() + 14 * 86400000 })} className="press hit grid h-8 w-8 shrink-0 place-items-center rounded-full text-fg-3"><XIcon size={14} /></button>
              </motion.div>
            )}

            <motion.div variants={stagger.item}><OrbitaSuggestionsCard /></motion.div>

            {/* Astra */}
            <motion.div variants={stagger.item} className="mt-9">
              <AstraHub
                birthdays={dates.filter(d => d.days <= 7).length}
                cooling={coolingClose(people ?? [], now).length}
                intros={matches.length}
                onWeekly={() => nav('/weekly')}
                onVoice={() => nav('/capture')}
                onAsk={() => nav('/chat')}
                onEvent={() => nav('/event')}
              />
            </motion.div>

            {/* Reasons to write */}
            {occasions.filter(o => o.kind !== 'silence').length > 0 && (
              <motion.div variants={stagger.item}>
                <SectionTitle count={occasions.filter(o => o.kind !== 'silence').length}>{t('Reasons to reach out')}</SectionTitle>
                <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
                  {occasions.filter(o => o.kind !== 'silence').slice(0, 10).map(o => {
                    const p = byId.get(o.personId)
                    return p ? <OccasionCard key={o.id} o={o} p={p} onWrite={() => open({ kind: 'draft', personId: p.id, occasion: o })} /> : null
                  })}
                </div>
              </motion.div>
            )}

            {/* Matchmaker */}
            {matches.length > 0 && (
              <motion.div variants={stagger.item}>
                <SectionTitle count={matches.length} action={t('All')} onAction={() => nav('/intros')}>{t('Could be introduced')}</SectionTitle>
                <MatchCard m={matches[0]} onOpen={() => open({ kind: 'intro', aId: matches[0].a.id, bId: matches[0].b.id, reason: matches[0].reason, value: matches[0].value })} />
              </motion.div>
            )}

            {/* Whom to write to */}
            <motion.div variants={stagger.item}>
              <SectionTitle count={due.length} action={due.length ? t('Review') : undefined} onAction={() => nav('/review')}>{t('Get in touch')}</SectionTitle>
              {due.length === 0 ? (
                <div className="glass glow-card flex items-center gap-4 rounded-[26px] p-5" style={{ ['--glow' as string]: 'rgb(95 227 176 / 0.25)' }}>
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-mint/15 text-mint"><CheckIcon size={20} weight="bold" /></span>
                  <div>
                    <div className="text-[16px] font-semibold">{t('All connections are on rhythm')}</div>
                    <div className="text-[13.5px] text-fg-3">{t('No one is waiting — you could meet someone new')}</div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {due.slice(0, 3).map(({ p }) => <DueCard key={p.id} p={p} circles={circles} now={now} occasion={occByPerson.get(p.id)} />)}
                  {due.length > 3 && (
                    <button type="button" onClick={() => nav('/review')} className="press glass flex items-center justify-between rounded-[22px] px-4 py-3.5">
                      <span className="flex items-center gap-3">
                        <span className="flex -space-x-2.5">
                          {due.slice(3, 7).map(({ p }) => <Avatar key={p.id} person={p} size={28} className="ring-2 ring-ink-2 rounded-full" />)}
                        </span>
                        <span className="text-[14.5px] font-medium">{t('More')}{' '}{tn(due.length - 3, '{n} person', '{n} people')}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-[13.5px] text-fg-2"><CardsThreeIcon size={17} />{' '}{t('Go through the deck')}</span>
                    </button>
                  )}
                </div>
              )}
            </motion.div>

            {/* Person of the day */}
            {potd && (
              <motion.div variants={stagger.item}>
                <SectionTitle>{t('Recall today')}</SectionTitle>
                <LampCard p={potd.p} now={now} occasion={occByPerson.get(potd.p.id)} />
              </motion.div>
            )}

            {/* Reminders */}
            {openReminders.length > 0 && (
              <motion.div variants={stagger.item}>
                <SectionTitle count={openReminders.length} action={t('Add')} onAction={() => open({ kind: 'reminder' })}>{t('Reminders')}</SectionTitle>
                <Group>
                  {openReminders.slice(0, 5).map(r => <ReminderRow key={r.id} r={r} person={r.personId ? byId.get(r.personId) : undefined} />)}
                </Group>
              </motion.div>
            )}

            {/* Dates: birthdays, anniversaries, jubilees */}
            {dates.length > 0 && (
              <motion.div variants={stagger.item} id="bdays">
                <SectionTitle count={dates.length}>{t('Upcoming dates')}</SectionTitle>
                <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
                  {dates.map(d => (
                    <Link key={d.key} to={`/person/${d.person.id}`} className="press glass glow-card w-[156px] shrink-0 snap-start rounded-[24px] p-4"
                      style={{ ['--glow' as string]: d.round ? 'rgb(255 210 122 / 0.5)' : d.days <= 3 ? 'rgb(255 120 180 / 0.45)' : 'rgb(255 120 180 / 0.18)', ['--gx' as string]: '80%', ['--gy' as string]: '0%' }}>
                      <Avatar person={d.person} size={46} />
                      <div className="mt-3 truncate text-[15px] font-semibold">{d.person.firstName}</div>
                      <div className="truncate text-[12.5px] text-fg-3">{d.kind === 'birthday' ? t('Birthday') : d.label.split(':')[0]}</div>
                      <div className="text-[12px] text-fg-4">{dateShort(d.date)}{d.years ? ` · ${d.years}${d.round ? ' ✦' : ''}` : ''}</div>
                      <div className={`mt-2.5 text-[20px] font-semibold tracking-[-0.02em] ${d.days === 0 ? 'text-[#ff8fb8]' : ''}`}>
                        {d.days === 0 ? t('Today 🎉') : d.days === 1 ? t('Tomorrow') : <><span className="tnum">{d.days}</span> <span className="text-[14px] font-medium text-fg-3">{tn(d.days, 'day', 'days')}</span></>}
                      </div>
                    </Link>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Recently */}
            {recent.length > 0 && (
              <motion.div variants={stagger.item}>
                <SectionTitle action={t('Log')} onAction={() => open({ kind: 'log' })}>{t('Recently')}</SectionTitle>
                <Timeline items={recent} people={byId} />
              </motion.div>
            )}
          </>
        )}
      </motion.section>
    </Page>
  )
}

function StatTile({ icon: I, value, label, color, onClick }: { icon: typeof CakeIcon; value: number; label: string; color: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="press glass glow-card flex flex-col items-start rounded-[22px] p-3.5 text-left"
      style={{ ['--glow' as string]: `color-mix(in srgb, ${color} 30%, transparent)`, ['--gx' as string]: '0%', ['--gy' as string]: '0%' }}>
      <I size={18} weight="duotone" style={{ color }} />
      <div className="tnum mt-3 text-[26px] font-semibold leading-none tracking-[-0.03em]">{value}</div>
      <div className="mt-1.5 text-[12px] leading-tight text-fg-3">{label}</div>
    </button>
  )
}

/** A "time to reach out" card: the Revolut "Remind" pattern. */
function DueCard({ p, now, circles, occasion }: { p: Person; now: number; circles: { id: string; name: string }[]; occasion?: Occasion }) {
  const nav = useNavigate()
  const open = useUI(s => s.open)
  const quickLog = useQuickLog()
  const toast = useUI(s => s.toast)
  const w = warmthOf(p, now)
  const topic = p.topics.find(topic2 => !topic2.done)
  const circle = circles.find(c => p.circleIds.includes(c.id))
  return (
    <motion.div layout className="glass rounded-[26px] p-4">
      <button type="button" onClick={() => nav(`/person/${p.id}`)} className="flex w-full items-center gap-3.5 text-left">
        <Avatar person={p} size={50} warmth={w.level} ring />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[16.5px] font-semibold">{p.firstName} {p.lastName}</span>
          </div>
          <div className="mt-0.5 truncate text-[13px] text-fg-3">
            {tn(w.daysSince, '{n} day', '{n} days')}{' '}{t('without contact')}{circle ? ` · ${circle.name}` : ''}
          </div>
        </div>
        <Pill color={WARMTH_COLORS[w.level]}>{WARMTH_LABEL[w.level]}</Pill>
      </button>
      {occasion && occasion.kind !== 'silence' ? (
        <div className="mt-3 flex items-start gap-2 rounded-[16px] bg-white/[0.04] px-3.5 py-2.5 text-[13.5px] text-fg-2">
          <span>{OCCASION_META[occasion.kind].emoji}</span><span><span style={{ color: OCCASION_META[occasion.kind].color }}>{occasion.title}:</span> {occasion.detail}</span>
        </div>
      ) : topic && (
        <div className="mt-3 rounded-[16px] bg-white/[0.04] px-3.5 py-2.5 text-[13.5px] text-fg-2">
          <span className="text-fg-3">{t('Topic:')}{' '}</span>{topic.text}
        </div>
      )}
      <div className="mt-3.5 flex gap-2">
        <button type="button" onClick={() => open({ kind: 'draft', personId: p.id, occasion: occasion ?? null })} className="press btn-primary h-11 flex-1 text-[15px]">
          <PaperPlaneTiltIcon size={17} weight="bold" />{' '}{t('Write')}
        </button>
        <button type="button" onClick={() => quickLog(p)} title={t('We were in touch — mark as today')} className="press btn-glass h-11 flex-1">
          <CheckIcon size={16} weight="bold" />{' '}{t('Mark')}
        </button>
        <button type="button" aria-label={t('Postpone for a week')} title={t('Postpone for a week')} onClick={async () => { await snooze(p.id, 7); toast(t("{firstName} — I'll remind you in a week", { firstName: p.firstName }), 'bell') }} className="press btn-glass h-11 w-11 shrink-0 !px-0">
          <ClockCountdownIcon size={18} />
        </button>
      </div>
    </motion.div>
  )
}

/** The "lamp" (Lumy): a card lit from above. The person of the day. */
function LampCard({ p, now, occasion }: { p: Person; now: number; occasion?: Occasion }) {
  const nav = useNavigate()
  const open = useUI(s => s.open)
  const w = warmthOf(p, now)
  const knownDays = p.metAt ? daysBetween(new Date(p.metAt).getTime(), now) : null
  const topic = p.topics.find(topic3 => !topic3.done)
  return (
    <div className="glass relative overflow-hidden rounded-[30px] px-5 pb-5 pt-14 text-center">
      {/* lamp */}
      <div aria-hidden className="absolute left-1/2 top-0 -translate-x-1/2">
        <div className="mx-auto h-5 w-px bg-white/25" />
        <div className="mx-auto h-[10px] w-[34px] rounded-b-full bg-gradient-to-b from-[#3a3a46] to-[#1c1c24] shadow-[0_2px_0_rgba(255,255,255,0.05)]" />
        <div className="mx-auto -mt-[3px] h-[6px] w-[14px] rounded-full bg-[#fff1d6] shadow-[0_0_18px_6px_rgba(255,214,150,0.7)]" />
      </div>
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[24px] h-[300px] w-[360px] -translate-x-1/2"
        style={{ background: 'radial-gradient(50% 70% at 50% 0%, rgba(255,214,150,0.28), transparent 75%)', clipPath: 'polygon(42% 0, 58% 0, 100% 100%, 0 100%)' }} />
      <button type="button" onClick={() => nav(`/person/${p.id}`)} className="relative mx-auto flex flex-col items-center">
        <Avatar person={p} size={76} warmth={w.level} ring />
        <div className="mt-3.5 text-[20px] font-semibold tracking-[-0.02em]">{p.firstName} {p.lastName}</div>
        <div className="mt-0.5 text-[13.5px] text-fg-3">{jobLine(p) || p.city}</div>
      </button>
      <p className="relative mx-auto mt-4 max-w-[320px] text-[14.5px] leading-relaxed text-fg-2">
        {knownDays && knownDays > 30 ? <>{t("You've known each other for")}{' '}{knownDays > 365 ? tn(Math.floor(knownDays / 365), '{n} year', '{n} years') : tn(Math.round(knownDays / 30), '{n} month', '{n} months')}. </> : null}
        {t('Last in touch')}{' '}{ago(contactAnchor(p), now)}.
        {topic ? <>{' '}{t('Ask:')}{' '}<span className="text-fg">«{topic.text}»</span></> : p.metPlace ? <>{' '}{t('You met:')}{' '}{p.metPlace}.</> : null}
      </p>
      <div className="relative mt-5 flex justify-center gap-2">
        <PrimaryButton className="!h-11 !text-[15px]" onClick={() => open({ kind: 'draft', personId: p.id, occasion: occasion ?? null })}><PaperPlaneTiltIcon size={17} weight="bold" />{' '}{t('Write')}</PrimaryButton>
        <button type="button" className="press btn-glass !h-11" onClick={() => open({ kind: 'brief', personId: p.id })}>
          <FileTextIcon size={17} />{' '}{t('Brief')}
        </button>
      </div>
    </div>
  )
}

/** Astra's hub: the weekly brief plus quick actions. */
function AstraHub({ birthdays, cooling, intros, onWeekly, onVoice, onAsk, onEvent }: { birthdays: number; cooling: number; intros: number; onWeekly: () => void; onVoice: () => void; onAsk: () => void; onEvent: () => void }) {
  const parts = [
    birthdays && tn(birthdays, '{n} birthday', '{n} birthdays'),
    cooling && t('{pl} cooling', { pl: tn(cooling, '{n} close contact', '{n} close contacts') }),
    intros && tn(intros, '{n} introduction', '{n} introductions'),
  ].filter(Boolean)
  return (
    <div className="rounded-[30px] p-1.5" style={astraGlow}>
      <button type="button" onClick={onWeekly} className="press relative flex w-full items-center gap-4 overflow-hidden rounded-[24px] px-4 py-4 text-left">
        <div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(80% 120% at 0% 0%, rgb(255 200 150 / 0.18), transparent 60%), radial-gradient(60% 100% at 100% 100%, rgb(124 92 255 / 0.18), transparent 60%)' }} />
        <AstraStar size={40} className="relative" />
        <span className="relative min-w-0 flex-1">
          <span className="micro block text-[#ffe2c2]">{t('Astra · weekly brief')}</span>
          <span className="display mt-1 block text-[22px] leading-tight">{parts.length ? parts.join(' · ') : t('A quiet week')}</span>
        </span>
      </button>
      <div className="grid grid-cols-3 gap-1.5 px-1 pb-1">
        <HubBtn icon={MicrophoneIcon} label={t('Dictate')} onClick={onVoice} accent />
        <HubBtn icon={ChatCircleDotsIcon} label={t('Talk')} onClick={onAsk} />
        <HubBtn icon={CalendarStarIcon} label={t('Event')} onClick={onEvent} />
      </div>
    </div>
  )
}

function HubBtn({ icon: I, label, onClick, accent }: { icon: typeof MicrophoneIcon; label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`press flex h-[52px] items-center justify-center gap-2 rounded-[18px] text-[13.5px] font-semibold ${accent ? 'text-ink' : 'bg-white/[0.06] text-fg'}`}
      style={accent ? { background: 'radial-gradient(circle at 30% 20%, #fff, #ffe2bd 55%, #c9b8ff 100%)' } : undefined}>
      <I size={17} weight={accent ? 'fill' : 'regular'} /> {label}
    </button>
  )
}

function OccasionCard({ o, p, onWrite }: { o: Occasion; p: Person; onWrite: () => void }) {
  const meta = OCCASION_META[o.kind]
  return (
    <div className="glass glow-card flex w-[236px] shrink-0 snap-start flex-col rounded-[26px] p-4"
      style={{ ['--glow' as string]: `color-mix(in srgb, ${meta.color} 26%, transparent)`, ['--gx' as string]: '100%', ['--gy' as string]: '0%' }}>
      <div className="flex items-center gap-3">
        <Avatar person={p} size={42} />
        <div className="min-w-0">
          <div className="truncate text-[15.5px] font-semibold">{p.firstName} {p.lastName?.[0] ? `${p.lastName[0]}.` : ''}</div>
          <div className="text-[12.5px] font-medium leading-tight" style={{ color: meta.color }}>{meta.emoji} {o.title}</div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 min-h-[40px] text-[13.5px] leading-snug text-fg-2">{o.detail}</p>
      <button type="button" onClick={onWrite} className="press btn-primary mt-3 h-10 w-full text-[14px]"><PaperPlaneTiltIcon size={15} weight="bold" />{' '}{t('Write')}</button>
    </div>
  )
}

function MatchCard({ m, onOpen }: { m: MatchPair; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="press glass glow-card block w-full rounded-[28px] p-4 text-left" style={{ ['--glow' as string]: 'rgb(127 214 255 / 0.2)', ['--gx' as string]: '50%', ['--gy' as string]: '0%' }}>
      <div className="flex items-center">
        <Avatar person={m.a} size={44} />
        <div className="relative mx-2 h-px flex-1">
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgb(255 217 168 / 0.15), rgb(255 217 168 / 0.85), rgb(167 150 255 / 0.85), rgb(167 150 255 / 0.15))', boxShadow: '0 0 10px rgb(255 200 150 / 0.5)' }} />
          <AstraStar size={14} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <Avatar person={m.b} size={44} />
      </div>
      <p className="mt-3 text-[14.5px] leading-relaxed">{m.reason}</p>
      <div className="mt-2 text-[13px] font-semibold text-[#9fdcff]">{t('Introduce')}{' '}{m.a.firstName}{' '}{t('and')}{' '}{m.b.firstName} →</div>
    </button>
  )
}
