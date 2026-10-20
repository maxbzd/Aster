import { motion } from 'motion/react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import {
  BabyIcon, CakeIcon, CalendarPlusIcon, CalendarStarIcon, ClockIcon, ConfettiIcon, FolderSimpleIcon, ForkKnifeIcon, HeartIcon, PlusIcon, PushPinIcon, SparkleIcon, TranslateIcon, WarningIcon, WineIcon, type Icon,
} from '@phosphor-icons/react'
import { Avatar } from '@/components/Avatar'
import { WarmthChart, warmthColorOf, warmthWord } from '@/components/WarmthChart'
import { Group, Pill, Row, SectionTitle } from '@/components/ui'
import { CHANNELS } from '@/components/icons'
import { ALCOHOL_LABEL, LANGUAGES, prefsEmpty, TIME_LABEL } from '@/sheets/PrefsSheet'
import { STATUS_META } from '@/sheets/StatusSheet'
import { collectionsOf } from '@/data/collections'
import { nextOccurrence, yearsText } from '@/data/dates'
import { ageOf, convertFamilyText, familyOfPerson, parseFamilyText, RELATION_EMOJI, RELATION_LABEL } from '@/data/family'
import { reciprocity, suggestCadence, warmthHistory, warmthTrend, yearSummaries, type CadenceSuggestion } from '@/data/history'
import { nextBirthday } from '@/data/logic'
import { patchPerson } from '@/data/actions'
import { useAllPeople, useCollections } from '@/data/hooks'
import { download, birthdayICS } from '@/lib/ics'
import { PALETTES } from '@/lib/colors'
import { dateLong, fromISODate, fullName, inDays, monthGen } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import type { DateKind, Interaction, Person } from '@/data/types'
import { t, tn } from '@/i18n'

const DATE_ICON: Record<DateKind, Icon> = { anniversary: HeartIcon, nameday: SparkleIcon, jubilee: ConfettiIcon, event: PushPinIcon, custom: CalendarStarIcon }

/* ---------- relationship status ---------- */

export function StatusBanner({ p }: { p: Person }) {
  const open = useUI(s => s.open)
  const toast = useUI(s => s.toast)
  if (!p.lifeStatus) return null
  const m = STATUS_META[p.lifeStatus]
  return (
    <div className="glass mt-6 rounded-[24px] p-4" style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${m.color} 30%, transparent)` }}>
      <div className="flex items-center gap-2.5" style={{ color: m.color }}>
        <m.icon size={20} weight="duotone" />
        <span className="text-[15px] font-semibold">{m.label}</span>
      </div>
      {p.lifeStatusNote && <p className="mt-2 text-[14px] leading-relaxed text-fg-2">{p.lifeStatusNote}</p>}
      <p className="mt-1.5 text-[12.5px] text-fg-3">{t('No reminders or reasons to reach out. The card and history are kept.')}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={async () => { await patchPerson(p.id, { lifeStatus: undefined, lifeStatusNote: undefined, lifeStatusAt: undefined }); toast(t('Back to normal network life'), 'info') }}
          className="press rounded-full bg-fg px-4 py-2 text-[13.5px] font-semibold text-ink">{t('Return to network')}</button>
        <button type="button" onClick={() => open({ kind: 'status', personId: p.id })} className="press rounded-full bg-white/[0.07] px-4 py-2 text-[13.5px] text-fg-2">{t('Edit')}</button>
      </div>
    </div>
  )
}

/* ---------- rhythm and the "around every day" mode ---------- */

export function RhythmMode({ p }: { p: Person }) {
  const toast = useUI(s => s.toast)
  if (p.familyOf) {
    return (
      <div className="glass mt-3 rounded-[28px] p-5">
        <div className="flex items-center gap-2 text-[15px] font-semibold"><HeartIcon size={18} weight="duotone" className="text-[#ff9ec7]" />{' '}{t('Family without rhythm')}</div>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-3">{t("With close ones you don't need a “time to write” calendar. Dates matter here: birthdays and anniversaries remind you on their own.")}</p>
      </div>
    )
  }
  if (!p.everyday) return null
  return (
    <div className="glass mt-3 rounded-[28px] p-5">
      <div className="flex items-center gap-2 text-[15px] font-semibold"><SparkleIcon size={18} weight="duotone" className="text-warm" />{' '}{t('Together every day')}</div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-3">{t('You talk all the time anyway, so there are no reminders, rhythm or “what we talked about before” here. Birthdays and important dates stay.')}</p>
      <button type="button" onClick={async () => { await patchPerson(p.id, { everyday: undefined }); toast(t('Rhythm restored'), 'info') }} className="press mt-3 rounded-full bg-white/[0.07] px-4 py-2 text-[13.5px] text-fg-2">{t('Restore rhythm')}</button>
    </div>
  )
}

export function EverydayToggle({ p }: { p: Person }) {
  const toast = useUI(s => s.toast)
  if (p.familyOf || p.everyday || p.lifeStatus) return null
  return (
    <button type="button" onClick={async () => { await patchPerson(p.id, { everyday: true }); toast(t('Together every day: no reminders'), 'info') }}
      className="press mt-2.5 flex w-full items-center gap-2.5 px-2 py-1.5 text-left text-[13.5px] text-fg-3">
      <SparkleIcon size={15} />{' '}{t("We're together every day anyway — remove the rhythm")}
    </button>
  )
}

/** Astra's hint: the rhythm does not match real life. */
export function CadenceHint({ p, ints }: { p: Person; ints: Interaction[] }) {
  const toast = useUI(s => s.toast)
  const s = useMemo(() => suggestCadence(p, ints), [p, ints])
  const hidden = p.cadenceHintDismissedAt !== undefined && Date.now() - p.cadenceHintDismissedAt < 90 * 86400000
  if (!s || hidden) return null
  return <CadenceHintCard s={s} onApply={async () => { await patchPerson(p.id, { cadenceDays: s.suggested }); toast(t('Rhythm updated')) }} onDismiss={() => patchPerson(p.id, { cadenceHintDismissedAt: Date.now() })} />
}

export function CadenceHintCard({ s, onApply, onDismiss, who }: { s: CadenceSuggestion; onApply: () => void; onDismiss: () => void; who?: string }) {
  const opt = { 7: t('once a week'), 14: t('every 2 weeks'), 30: t('once a month'), 90: t('once a quarter'), 180: t('every six months'), 365: t('once a year') }[s.suggested] ?? t('every {suggested} days', { suggested: s.suggested })
  return (
    <div className="glass glow-card mt-3 rounded-[24px] p-4" style={{ ['--glow' as string]: 'rgb(124 92 255 / 0.3)', ['--gx' as string]: '0%', ['--gy' as string]: '0%' }}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-accent"><SparkleIcon size={14} weight="fill" />{' '}{t("Astra's suggestion")}{who ? ` · ${who}` : ''}</div>
      <p className="mt-2 text-[14.5px] leading-relaxed text-fg">{s.message}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => { haptic(10); onApply() }} className="press rounded-full bg-fg px-4 py-2 text-[13.5px] font-semibold text-ink">{t('Set')}{' '}{opt}</button>
        <button type="button" onClick={onDismiss} className="press rounded-full bg-white/[0.07] px-4 py-2 text-[13.5px] text-fg-2">{t('Not now')}</button>
      </div>
    </div>
  )
}

/* ---------- family ---------- */

export function FamilySection({ p }: { p: Person }) {
  const all = useAllPeople()
  const open = useUI(s => s.open)
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const members = useMemo(() => familyOfPerson(all ?? [], p.id), [all, p.id])
  const legacy = useMemo(() => (p.family ? parseFamilyText(p.family) : null), [p.family])
  if (p.familyOf) return null
  return (
    <>
      <SectionTitle action={t('Add')} onAction={() => open({ kind: 'family', ownerId: p.id })} count={members.length || undefined}>{t('Family')}</SectionTitle>
      {members.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {members.map(m => {
            const age = ageOf(m.birthday)
            const b = nextBirthday(m.birthday)
            return (
              <button key={m.id} type="button" onClick={() => open({ kind: 'family', ownerId: p.id, id: m.id })} className="press glass flex items-center gap-3 rounded-[22px] p-3.5 text-left">
                <Avatar person={m} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{m.firstName}{age !== null ? <span className="font-normal text-fg-3">, {age}</span> : null}</span>
                  <span className="block truncate text-[12.5px] text-fg-3">{RELATION_EMOJI[m.relation ?? 'relative']} {RELATION_LABEL[m.relation ?? 'relative']}</span>
                  {b ? <span className="mt-0.5 block truncate text-[12px]" style={{ color: b.days <= 14 ? '#ff8fb8' : undefined }}>{b.days === 0 ? t('Birthday today 🎂') : t('Birthday: {monthGen} {getDate} · {inDays}', { getDate: new Date(b.date).getDate(), monthGen: monthGen(new Date(b.date).getMonth()), inDays: inDays(b.days) })}</span>
                    : <span className="mt-0.5 block truncate text-[12px] text-fg-4">{t('birthday not set')}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {legacy && (
        <div className="glass mt-2.5 rounded-[22px] p-4">
          <div className="text-[12.5px] text-fg-3">{t('From an old family note')}</div>
          <div className="mt-1 text-[15px]">{p.family}</div>
          {legacy.members.length > 0 && (
            <button type="button" onClick={async () => { const r = await convertFamilyText(p.id); toast(r.created ? t('Added to the family: {created}', { created: r.created }) : t('Everyone is already in the family'), 'info') }}
              className="press mt-3 rounded-full bg-fg px-4 py-2 text-[13.5px] font-semibold text-ink">{t('Split into cards (')}{legacy.members.length})</button>
          )}
        </div>
      )}
      {!members.length && !legacy && (
        <button type="button" onClick={() => open({ kind: 'family', ownerId: p.id })} className="press flex w-full items-center gap-3 rounded-[22px] border border-dashed border-white/12 px-4 py-4 text-left text-[14.5px] text-fg-3">
          <BabyIcon size={18} />{' '}{t('Partner, children, parents — each with their own birthday')}
        </button>
      )}
      {members.length > 0 && <button type="button" onClick={() => nav(`/person/${members[0]!.id}`)} className="sr-only">{t('Open the card')}{' '}{members[0]!.firstName}</button>}
    </>
  )
}

/* ---------- important dates ---------- */

export function DatesSection({ p, now }: { p: Person; now: number }) {
  const open = useUI(s => s.open)
  const toast = useUI(s => s.toast)
  const bday = nextBirthday(p.birthday, now)
  const dates = useMemo(() => (p.importantDates ?? []).map(d => ({ d, o: nextOccurrence(d.date, d.yearly !== false, now) })).sort((a, b) => (a.o?.days ?? 9999) - (b.o?.days ?? 9999)), [p.importantDates, now])
  return (
    <>
      <SectionTitle action={t('Add')} onAction={() => open({ kind: 'dateEdit', personId: p.id })}>{t('Important dates')}</SectionTitle>
      <Group>
        {bday ? (
          <Row icon={CakeIcon} iconColor="#ff8fb8"
            label={`${new Date(bday.date).getDate()} ${monthGen(new Date(bday.date).getMonth())}${bday.turning ? t(' · turns {turning}', { turning: bday.turning }) : ''}`}
            sub={bday.days === 0 ? t('Birthday today! 🎉') : t('Birthday {inDays}', { inDays: inDays(bday.days) })}
            trailing={<button type="button" title={t('Add to calendar')} aria-label={t('Add to calendar')} onClick={() => { download(t('{name} — birthday.ics', { name: fullName(p) }), birthdayICS(fullName(p), bday.date), 'text/calendar'); toast(t('Calendar event downloaded')) }} className="press grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-fg-2"><CalendarPlusIcon size={17} /></button>}
            chevron={false} />
        ) : (
          <Row icon={CakeIcon} label={<span className="text-fg-3">{t('Birthday not set')}</span>} onClick={() => open({ kind: 'editPerson', id: p.id })} />
        )}
        {dates.map(({ d, o }) => (
          <Row key={d.id} icon={DATE_ICON[d.kind]} iconColor="#ffd27a" label={d.label}
            sub={[d.date.startsWith('--') ? `${Number(d.date.slice(6))} ${monthGen(Number(d.date.slice(3, 5)) - 1)}` : dateLong(fromISODate(d.date)), o ? (o.days === 0 ? t('today') : inDays(o.days)) : t('passed'), o && yearsText({ kind: d.kind, years: o.years })].filter(Boolean).join(' · ')}
            onClick={() => open({ kind: 'dateEdit', personId: p.id, id: d.id })} />
        ))}
      </Group>
    </>
  )
}

/* ---------- preferences ---------- */

export function PrefsSection({ p }: { p: Person }) {
  const open = useUI(s => s.open)
  const x = p.prefs
  if (prefsEmpty(x)) {
    return (
      <>
        <SectionTitle>{t('How to communicate')}</SectionTitle>
        <button type="button" onClick={() => open({ kind: 'prefs', personId: p.id })} className="press flex w-full items-center gap-3 rounded-[22px] border border-dashed border-white/12 px-4 py-4 text-left text-[14.5px] text-fg-3">
          <PlusIcon size={16} />{' '}{t('Informal or formal, favorite channel, food, allergies, hobbies')}
        </button>
      </>
    )
  }
  const lang = LANGUAGES.find(l => l.code === x?.language)?.label
  return (
    <>
      <SectionTitle action={t('Edit')} onAction={() => open({ kind: 'prefs', personId: p.id })}>{t('How to communicate')}</SectionTitle>
      <div className="glass rounded-[26px] p-4">
        <div className="flex flex-wrap gap-1.5">
          {x?.address && <Pill color="#a796ff">{x.address === 'vy' ? t('Formal') : t('Informal')}</Pill>}
          {lang && <Pill color="#7fd6ff"><TranslateIcon size={12} className="-ml-0.5" />{lang}</Pill>}
          {x?.bestChannel && <Pill color="#5fe3b0">{CHANNELS[x.bestChannel].label}</Pill>}
          {x?.bestTime && <Pill color="#ffd27a"><ClockIcon size={12} className="-ml-0.5" />{TIME_LABEL[x.bestTime]}</Pill>}
        </div>
        {x?.allergies && (
          <div className="mt-3 flex items-start gap-2.5 rounded-[16px] bg-danger/10 px-3.5 py-2.5 text-[14px]"><WarningIcon size={17} weight="fill" className="mt-0.5 shrink-0 text-danger" /><span><b className="font-semibold">{t('Allergies and restrictions:')}</b> {x.allergies}</span></div>
        )}
        {(x?.food || x?.alcohol) && (
          <div className="mt-3 flex flex-col gap-2 text-[14.5px]">
            {x?.food && <div className="flex items-start gap-2.5"><ForkKnifeIcon size={17} className="mt-0.5 shrink-0 text-fg-3" />{x.food}</div>}
            {x?.alcohol && <div className="flex items-center gap-2.5"><WineIcon size={17} className="shrink-0 text-fg-3" />{ALCOHOL_LABEL[x.alcohol]}</div>}
          </div>
        )}
        {x?.hobbies && x.hobbies.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{x.hobbies.map(h => <span key={h} className="rounded-full border border-line bg-white/[0.05] px-3 py-1.5 text-[13.5px] text-fg-2">{h}</span>)}</div>}
      </div>
    </>
  )
}

/* ---------- warmth by year and reciprocity ---------- */

const TREND = { up: { get t() { return t('Connection is warming') }, c: '#ff9a52', a: '↗' }, down: { get t() { return t('Connection is cooling') }, c: '#74a6ff', a: '↘' }, flat: { get t() { return t('Steady') }, c: '#ffd27a', a: '→' } } as const

export function WarmthSection({ p, ints }: { p: Person; ints: Interaction[] }) {
  const pts = useMemo(() => warmthHistory(p, ints), [p, ints])
  const years = useMemo(() => yearSummaries(pts), [pts])
  const trend = warmthTrend(pts)
  const last = pts.at(-1)
  const enough = pts.length >= 3
  return (
    <>
      <SectionTitle>{t('Warmth by year')}</SectionTitle>
      <div className="glass rounded-[28px] p-4 pb-3">
        {enough ? (
          <>
            <div className="mb-1 flex items-center justify-between px-1">
              <div>
                <div className="micro text-fg-3">{t('Now')}</div>
                <div className="mt-1 text-[19px] font-semibold" style={{ color: last?.score != null ? warmthColorOf(last.score) : undefined }}>{last?.score != null ? `${warmthWord(last.score)} · ${last.score}` : '—'}</div>
              </div>
              {trend && <div className="text-right"><div className="micro text-fg-3">{t('Last 3 months')}</div><div className="mt-1 text-[15px] font-semibold" style={{ color: TREND[trend].c }}>{TREND[trend].a} {TREND[trend].t}</div></div>}
            </div>
            <WarmthChart points={pts} />
            {years.length > 1 && (
              <div className="-mx-1 mt-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {[...years].reverse().map(y => (
                  <div key={y.year} className="shrink-0 rounded-[16px] bg-white/[0.04] px-3 py-2">
                    <div className="text-[13px] font-semibold">{y.year}</div>
                    <div className="text-[12px] text-fg-3">{tn(y.contacts, '{n} contact', '{n} contacts')}</div>
                    {y.avgScore !== null && <div className="text-[12px]" style={{ color: warmthColorOf(y.avgScore) }}>{t('average')}{' '}{y.avgScore}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="px-2 py-8 text-center text-[14px] leading-relaxed text-fg-3">{t("History will appear once you've known each other for at least a couple of months and have some interaction records.")}</div>
        )}
      </div>
    </>
  )
}

export function ReciprocitySection({ p, ints }: { p: Person; ints: Interaction[] }) {
  const open = useUI(s => s.open)
  const r = useMemo(() => reciprocity(ints), [ints])
  const given = ints.filter(i => i.type === 'favor_given').length
  const got = ints.filter(i => i.type === 'favor_got').length
  const known = r.me + r.them + r.both
  if (known + given + got === 0) return null
  const col = r.level === 'balanced' ? '#5fe3b0' : r.level === 'unknown' ? undefined : '#ffd27a'
  return (
    <>
      <SectionTitle>{t('Reciprocity')}</SectionTitle>
      <div className="glass rounded-[26px] p-5">
        {known > 0 && (
          <>
            <div className="text-[13.5px] text-fg-2">{t('Who starts the conversation')}</div>
            <div className="mt-3 flex h-3 gap-[3px] overflow-hidden rounded-full">
              {[{ v: r.me, c: '#a796ff' }, { v: r.both, c: 'rgb(255 255 255 / 0.35)' }, { v: r.them, c: '#ffb36b' }].map((s, i) => s.v > 0 && (
                <motion.div key={i} initial={{ flexGrow: 0 }} animate={{ flexGrow: s.v }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} className="rounded-full" style={{ background: s.c, boxShadow: i !== 1 ? `0 0 12px ${s.c}88` : undefined }} />
              ))}
            </div>
            <div className="mt-2.5 flex justify-between text-[12.5px] text-fg-3">
              <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#a796ff]" />{t('Me ·')}{' '}{r.me}</span>
              {r.both > 0 && <span>{t('Together ·')}{' '}{r.both}</span>}
              <span>{t('Them ·')}{' '}{r.them}<i className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[#ffb36b]" /></span>
            </div>
            <div className="mt-3 text-[14px] font-medium" style={{ color: col }}>{r.label}</div>
            {r.level === 'them' && <p className="mt-1 text-[13px] leading-relaxed text-fg-3">{t('People write to you more often themselves — a great reason to suggest a meeting first.')}</p>}
            {r.level === 'me' && <p className="mt-1 text-[13px] leading-relaxed text-fg-3">{t("You put in more. See whether it's reciprocated, and don't burn out on this connection.")}</p>}
          </>
        )}
        {r.unknown > 0 && known < 3 && <button type="button" onClick={() => open({ kind: 'log', personIds: [p.id] })} className="press mt-2 text-[12.5px] text-fg-3 underline decoration-white/20 underline-offset-4">{t('Mark who started in your records — and a picture will appear here')}</button>}
        {given + got > 0 && (
          <div className={known > 0 ? 'mt-5 border-t border-line pt-4' : ''}>
            <div className="flex justify-between text-[13.5px]">
              <span className="text-fg-2">{t('Your help')}{' '}<b className="tnum text-fg">{given}</b></span>
              <span className="text-fg-2">{t('Help for you')}{' '}<b className="tnum text-fg">{got}</b></span>
            </div>
            <div className="mt-3 flex h-2.5 gap-1 overflow-hidden rounded-full">
              <motion.div initial={{ width: 0 }} animate={{ width: `${(given / (given + got)) * 100}%` }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} className="rounded-full bg-mint" style={{ boxShadow: '0 0 12px rgb(95 227 176 / 0.6)' }} />
              <div className="flex-1 rounded-full bg-warm" style={{ boxShadow: '0 0 12px rgb(255 210 122 / 0.5)' }} />
            </div>
            <div className="mt-3 text-[13px] text-fg-3">{given > got ? t("You invest more in this connection — that's a good investment.") : got > given ? t("You've been helped more often — a great reason to do something in return.") : t('The relationship is in mutual balance.')}</div>
          </div>
        )}
      </div>
    </>
  )
}

/* ---------- lists ---------- */

export function CollectionsSection({ p }: { p: Person }) {
  const cs = useCollections()
  const open = useUI(s => s.open)
  const mine = collectionsOf(cs, p.id)
  return (
    <>
      <SectionTitle action={cs.length ? t('Edit') : t('Create')} onAction={() => open(cs.length ? { kind: 'collectionPick', personIds: [p.id] } : { kind: 'collectionEdit', addPersonIds: [p.id] })}>{t('Lists')}</SectionTitle>
      {mine.length ? (
        <div className="flex flex-wrap gap-2">
          {mine.map(c => <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full py-1.5 pl-2.5 pr-3.5 text-[13.5px] font-medium" style={{ background: `linear-gradient(135deg, ${PALETTES[c.palette].from}33, ${PALETTES[c.palette].to}1a)`, border: `1px solid ${PALETTES[c.palette].from}55` }}>{c.emoji} {c.name}</span>)}
        </div>
      ) : (
        <button type="button" onClick={() => open(cs.length ? { kind: 'collectionPick', personIds: [p.id] } : { kind: 'collectionEdit', addPersonIds: [p.id] })} className="press flex w-full items-center gap-3 rounded-[22px] border border-dashed border-white/12 px-4 py-4 text-left text-[14.5px] text-fg-3">
          <FolderSimpleIcon size={17} />{' '}{t('“For the round”, “for hiring”, “for PR” — build your own list')}
        </button>
      )}
    </>
  )
}

/* ---------- small things ---------- */

export function StatusPill({ p }: { p: Person }) {
  if (p.lifeStatus) { const m = STATUS_META[p.lifeStatus]; return <Pill color={m.color}><m.icon size={12} weight="fill" className="-ml-0.5" />{m.short}</Pill> }
  if (p.everyday) return <Pill color="#ffd27a"><SparkleIcon size={12} weight="fill" className="-ml-0.5" />{t('Together every day')}</Pill>
  return null
}
