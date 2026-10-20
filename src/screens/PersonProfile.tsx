import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeftIcon, BellSimpleIcon, ChatCircleDotsIcon, CheckIcon, DotsThreeIcon, FileTextIcon, HandshakeIcon, HeartIcon, LightbulbIcon,
  MagnifyingGlassIcon, MapPinIcon, PencilSimpleIcon, PhoneIcon, PlanetIcon, PlusIcon, StarIcon, UserPlusIcon, UsersIcon, VaultIcon, GiftIcon, StarFourIcon,
} from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { Avatar } from '@/components/Avatar'
import { FlipCounter } from '@/components/FlipCounter'
import { ReminderRow, Timeline } from '@/components/Timeline'
import { PersonOrbita } from '@/bridge/Bits'
import { ActionButton, Chip, Group, IconButton, Pill, Row, SectionTitle, Segmented } from '@/components/ui'
import { CHANNELS, FACT_ICONS, INTERACTION_ORDER, INTERACTIONS } from '@/components/icons'
import { useAllPeople, useCircles, useInteractionsFor, useLeads, useNow, usePerson, useRemindersFor } from '@/data/hooks'
import { CADENCE_OPTIONS, cadenceLabel, CLOSENESS, warmthOf, WARMTH_LABEL, contactAnchor } from '@/data/logic'
import { patchPerson } from '@/data/actions'
import { RELATION_LABEL } from '@/data/family'
import { PALETTES, personGradient, WARMTH_COLORS } from '@/lib/colors'
import { ago, dateLong, daysBetween, fromISODate, fullName, inDays, jobLine } from '@/lib/format'
import { openChannel, phoneOf } from '@/lib/contact'
import { useUI } from '@/app/store'
import { useLocalMatches, useOccasions } from '@/ai/hooks'
import { OCCASION_META } from '@/ai/local/occasions'
import { askReserve } from '@/ai/local/reserve'
import { AstraStar } from '@/components/astra/Astra'
import { TIME_LABEL } from '@/sheets/PrefsSheet'
import { CadenceHint, CollectionsSection, DatesSection, EverydayToggle, FamilySection, PrefsSection, ReciprocitySection, RhythmMode, StatusBanner, StatusPill, WarmthSection } from './profile/Sections'
import { EmptyLine, InfoCard, MoreMenu, Notes, RhythmBar, Topics } from './profile/parts'
import { t, tn } from '@/i18n'

type Tab = 'overview' | 'history' | 'about' | 'links'
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', get label() { return t('Overview') } },
  { value: 'history', get label() { return t('History') } },
  { value: 'about', get label() { return t('Details') } },
  { value: 'links', get label() { return t('Links') } },
]

export function PersonProfile() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const p = usePerson(id)
  const people = useAllPeople()
  const circles = useCircles()
  const ints = useInteractionsFor(id)
  const rems = useRemindersFor(id)
  const now = useNow()
  const nav = useNavigate()
  const open = useUI(s => s.open)
  const toast = useUI(s => s.toast)
  const { byPerson: occByPerson } = useOccasions()
  const matches = useLocalMatches()
  const leads = useLeads()
  const [menu, setMenu] = useState(false)
  const [cadenceOpen, setCadenceOpen] = useState(false)
  const tab = (TABS.find(tab2 => tab2.value === params.get('tab'))?.value ?? 'overview') as Tab
  const setTab = (value2: Tab) => setParams(prev => { const n = new URLSearchParams(prev); if (value2 === 'overview') n.delete('tab'); else n.set('tab', value2); return n }, { replace: true })

  const byId = useMemo(() => new Map((people ?? []).map(x => [x.id, x])), [people])
  // у кого из резерва есть то, что этот человек ищет
  const fromReserve = useMemo(() => (p?.lookingFor ? askReserve(p.lookingFor, leads ?? [], 3).filter(h => h.score >= 4) : []), [p?.lookingFor, leads])

  if (p === undefined) return <Page><div /></Page>
  if (!p) {
    return (
      <Page>
        <div className="pt-24 text-center">
          <div className="text-[20px] font-semibold">{t('Person not found')}</div>
          <Link to="/people" className="mt-4 inline-block text-fg-2 underline">{t('Back to people')}</Link>
        </div>
      </Page>
    )
  }

  const g = personGradient(p.id)
  const w = warmthOf(p, now)
  const owner = p.familyOf ? byId.get(p.familyOf) : undefined
  const pCircles = circles.filter(c => p.circleIds.includes(c.id))
  const since = p.metAt ? fromISODate(p.metAt) : p.createdAt
  const knownDays = Math.max(0, daysBetween(since, now))
  const phone = phoneOf(p)
  const introducer = p.introducedBy ? byId.get(p.introducedBy) : undefined
  const introduced = (people ?? []).filter(x => x.introducedBy === p.id)
  const openRems = rems.filter(r => !r.done)
  const back = () => (window.history.length > 1 ? nav(-1) : nav(p.familyOf ? `/person/${p.familyOf}` : '/people'))
  const occasion = occByPerson.get(p.id)
  const helpers = matches.filter(m => m.a.id === p.id)
  const helpsOthers = matches.filter(m => m.b.id === p.id)
  const best = p.prefs?.bestChannel
  const noRhythm = w.cadence === 0

  return (
    <Page>
      {/* Шапка в цвете человека (Revolut) */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px]" style={{ left: '-30vw', right: '-30vw' }}>
        <div className="absolute inset-0" style={{
          background: `radial-gradient(45% 55% at 38% 0%, ${g.a}cc, transparent 70%), radial-gradient(40% 50% at 65% 8%, ${g.b}99, transparent 70%), linear-gradient(180deg, ${g.deep} 0%, ${g.deep}66 45%, transparent 100%)`,
          maskImage: 'linear-gradient(to bottom, #000 40%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 40%, transparent)',
        }} />
      </div>

      <div className="relative flex items-center justify-between pt-[calc(12px+var(--safe-top))]">
        <IconButton icon={ArrowLeftIcon} label={t('Back')} onClick={back} size={42} />
        <div className="flex gap-2">
          <IconButton icon={StarIcon} weight={p.pinned ? 'fill' : 'regular'} label={p.pinned ? t('Remove from favorites') : t('Add to favorites')} size={42}
            style={p.pinned ? { color: '#ffd27a' } : undefined}
            onClick={async () => { await patchPerson(p.id, { pinned: !p.pinned }); toast(p.pinned ? t('Removed from favorites') : t('Added to favorites')) }} />
          <IconButton icon={PencilSimpleIcon} label={t('Edit')} size={42} onClick={() => open({ kind: 'editPerson', id: p.id })} />
          <div className="relative">
            <IconButton icon={DotsThreeIcon} label={t('More')} size={42} weight="bold" onClick={() => setMenu(m => !m)} />
            <AnimatePresence>
              {menu && <MoreMenu p={p} onClose={() => setMenu(false)} />}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Герой */}
      <div className="relative mt-4 flex flex-col items-center text-center">
        <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className="relative grid h-[168px] w-[168px] place-items-center rounded-full"
          style={{ background: `radial-gradient(circle at 50% 35%, rgb(255 255 255 / 0.16), rgb(255 255 255 / 0.03) 70%)`, boxShadow: `0 0 80px -10px ${g.a}88, inset 0 1px 0 rgb(255 255 255 / 0.15)` }}>
          <Avatar person={p} size={128} warmth={w.level} ring />
        </motion.div>
        <h1 className="mt-4 text-[31px] font-bold leading-tight tracking-[-0.03em]">{fullName(p)}</h1>
        {p.nickname && <div className="display -mt-0.5 text-[22px] text-fg-2">«{p.nickname}»</div>}
        {jobLine(p) && <div className="mt-1 text-[15.5px] text-fg-2">{jobLine(p)}</div>}
        {p.city && <div className="mt-1 flex items-center gap-1 text-[14px] text-fg-3"><MapPinIcon size={14} weight="fill" />{p.city}</div>}
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {owner && (
            <button type="button" onClick={() => nav(`/person/${owner.id}`)} className="press">
              <Pill color="#ff9ec7"><HeartIcon size={12} weight="fill" className="-ml-0.5" />{RELATION_LABEL[p.relation ?? 'relative']} · {owner.firstName}</Pill>
            </button>
          )}
          {!noRhythm && <Pill color={WARMTH_COLORS[w.level]}>{WARMTH_LABEL[w.level]} · {ago(contactAnchor(p), now)}</Pill>}
          <StatusPill p={p} />
          {!owner && <Pill color="#c9c3ff"><PlanetIcon size={12} weight="fill" className="-ml-0.5" />{CLOSENESS[p.closeness].name}</Pill>}
          {pCircles.map(c => <Pill key={c.id} color={PALETTES[c.palette].to}>{c.emoji} {c.name}</Pill>)}
        </div>
      </div>

      {/* Быстрые действия */}
      <div className="relative mt-7 flex justify-center gap-1 sm:gap-3">
        <ActionButton icon={ChatCircleDotsIcon} label={t('Write')} primary onClick={() => open({ kind: 'draft', personId: p.familyOf ?? p.id, occasion: occasion ?? null })} />
        <ActionButton icon={FileTextIcon} label={t('Brief')} onClick={() => open({ kind: 'brief', personId: p.id })} />
        {phone && <ActionButton icon={PhoneIcon} label={t('Call')} onClick={() => openChannel({ type: 'phone', value: phone.value })} />}
        <ActionButton icon={CheckIcon} label={t('Log')} onClick={() => open({ kind: 'log', personIds: [p.id] })} />
        <ActionButton icon={BellSimpleIcon} label={t('Remind')} onClick={() => open({ kind: 'reminder', personId: p.id })} />
      </div>

      <StatusBanner p={p} />

      {/* Вкладки: карточка не должна быть бесконечной лентой */}
      <div className="sticky top-[calc(8px+var(--safe-top))] z-20 mt-7">
        <Segmented<Tab> options={TABS} value={tab} onChange={setTab} className="!bg-ink-2/95 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.8)]" />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {tab === 'overview' && (
            <>
              {/* Повод написать */}
              {occasion && occasion.kind !== 'silence' && (
                <button type="button" onClick={() => open({ kind: 'draft', personId: p.id, occasion })}
                  className="press glass glow-card mt-6 flex w-full items-center gap-3 rounded-[22px] px-4 py-3.5 text-left"
                  style={{ ['--glow' as string]: `color-mix(in srgb, ${OCCASION_META[occasion.kind].color} 28%, transparent)`, ['--gx' as string]: '0%', ['--gy' as string]: '50%' }}>
                  <span className="text-[22px]">{OCCASION_META[occasion.kind].emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold" style={{ color: OCCASION_META[occasion.kind].color }}>{occasion.title}</span>
                    <span className="block truncate text-[13px] text-fg-2">{occasion.detail}</span>
                  </span>
                  <span className="flex items-center gap-1 text-[13px] font-semibold text-fg"><AstraStar size={13} />{' '}{t('Write')}</span>
                </button>
              )}

              {/* Перекидной счётчик (CRED) */}
              <div className="glass relative mt-6 overflow-hidden rounded-[28px] px-5 pb-6 pt-5">
                <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-60" style={{
                  backgroundImage: 'linear-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px)',
                  backgroundSize: '28px 28px', transform: 'perspective(220px) rotateX(55deg)', transformOrigin: 'bottom', maskImage: 'linear-gradient(to top, #000, transparent)', WebkitMaskImage: 'linear-gradient(to top, #000, transparent)',
                }} />
                {knownDays === 0 ? (
                  <div className="relative py-2">
                    <div className="display text-[30px] leading-tight">{t('New acquaintance ✦')}</div>
                    <div className="mt-1.5 text-[14px] text-fg-3">{t('today')}{p.metPlace ? ` · ${p.metPlace}` : ''}{' '}{t("— write down what you talked about while it's fresh")}</div>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="text-[15px] text-fg-2">{p.metAt ? t("you've known each other for") : t('in your network for')}</div>
                    <div className="mt-3 flex items-end gap-3">
                      <FlipCounter value={knownDays} digits={4} height={58} />
                      <div className="pb-1.5 text-[15px] font-medium text-fg-2">{tn(knownDays, 'day', 'days')}</div>
                    </div>
                    <div className="mt-3 text-[13.5px] text-fg-3">{t('since')}{' '}{dateLong(since)}{p.metPlace ? ` · ${p.metPlace}` : ''}</div>
                  </div>
                )}
              </div>

              {/* Ритм общения (Opal-шкала) */}
              {!noRhythm && (
                <div className="glass mt-3 rounded-[28px] p-5">
                  <button type="button" aria-expanded={cadenceOpen} onClick={() => setCadenceOpen(o => !o)} className="press block w-full text-left">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="micro text-fg-3">{t('Contact rhythm')}</div>
                        <div className="mt-1.5 text-[17px] font-semibold">{cadenceLabel(w.cadence)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[13px] text-fg-3">{w.dueIn >= 0 ? t('next contact') : t('overdue by')}</div>
                        <div className="text-[17px] font-semibold" style={{ color: WARMTH_COLORS[w.level] }}>{w.dueIn >= 0 ? inDays(w.dueIn) : tn(-w.dueIn, '{n} day', '{n} days')}</div>
                      </div>
                    </div>
                    <RhythmBar ratio={w.ratio} color={WARMTH_COLORS[w.level]} />
                  </button>
                  <AnimatePresence>
                    {cadenceOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="flex flex-wrap gap-1.5 pt-4">
                          {CADENCE_OPTIONS.map(o => (
                            <Chip key={o.days} size="sm" active={w.cadence === o.days} onClick={async () => { await patchPerson(p.id, { cadenceDays: o.days }); setCadenceOpen(false) }}>{o.label}</Chip>
                          ))}
                        </div>
                        <EverydayToggle p={p} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
              {noRhythm && !p.lifeStatus && !p.everyday && !p.familyOf && (
                <div className="glass mt-3 rounded-[28px] p-5">
                  <div className="micro text-fg-3">{t('Contact rhythm')}</div>
                  <div className="mt-1.5 text-[17px] font-semibold">{t('No rhythm')}</div>
                  <div className="mt-1 text-[13px] text-fg-3">{t('Last contact:')}{' '}{ago(contactAnchor(p), now)}</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">{CADENCE_OPTIONS.filter(o => o.days > 0).slice(0, 4).map(o => <Chip key={o.days} size="sm" onClick={() => patchPerson(p.id, { cadenceDays: o.days })}>{o.label}</Chip>)}</div>
                </div>
              )}
              <RhythmMode p={p} />
              <CadenceHint p={p} ints={ints} />

              {/* Следующий шаг */}
              <SectionTitle action={t('Add')} onAction={() => open({ kind: 'reminder', personId: p.id })}>{t('Next step')}</SectionTitle>
              {openRems.length ? (
                <Group>{openRems.map(r => <ReminderRow key={r.id} r={r} person={p} showPerson={false} />)}</Group>
              ) : (
                <button type="button" onClick={() => open({ kind: 'reminder', personId: p.id })} className="press glass flex w-full items-center gap-3 rounded-[22px] px-4 py-4 text-left text-[15px] text-fg-2">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06]"><PlusIcon size={17} /></span>
                  {t('Plan when and why to write')}
                </button>
              )}

              {/* Контакты */}
              <SectionTitle action={p.channels.length ? t('Edit') : undefined} onAction={() => open({ kind: 'editPerson', id: p.id })}>{t('Contacts')}</SectionTitle>
              {p.channels.length ? (
                <Group>
                  {[...p.channels].sort((a, b) => Number(b.type === best) - Number(a.type === best)).map((c, i) => {
                    const meta = CHANNELS[c.type]
                    const isBest = c.type === best
                    return <Row key={i} icon={meta.icon} iconColor={isBest ? '#5fe3b0' : undefined} label={c.value}
                      sub={isBest ? t('{label} · best channel{v}', { label: meta.label, v: p.prefs?.bestTime ? `, ${TIME_LABEL[p.prefs.bestTime].toLowerCase()}` : '' }) : meta.label} onClick={() => openChannel(c)} />
                  })}
                </Group>
              ) : (
                <EmptyLine text={t('Add a phone, Telegram or email')} onClick={() => open({ kind: 'editPerson', id: p.id })} />
              )}

              {/* Как познакомились */}
              {(p.metAt || p.metPlace || p.metStory) && (
                <>
                  <SectionTitle>{t('How you met')}</SectionTitle>
                  <div className="glass glow-card rounded-[26px] p-5" style={{ ['--glow' as string]: `${g.a}44` }}>
                    {p.metPlace && <div className="text-[16px] font-semibold">{p.metPlace}</div>}
                    {p.metAt && <div className="mt-0.5 text-[13px] text-fg-3">{dateLong(fromISODate(p.metAt))}</div>}
                    {p.metStory && <p className="display mt-2.5 text-[21px] leading-snug text-fg">{p.metStory}</p>}
                  </div>
                </>
              )}

              {/* Темы для разговора */}
              <SectionTitle>{t('Talking points')}</SectionTitle>
              <Topics p={p} />
            </>
          )}

          {tab === 'history' && (
            <>
              <WarmthSection p={p} ints={ints} />
              <ReciprocitySection p={p} ints={ints} />

              <SectionTitle count={ints.length || undefined}>{t('Timeline')}</SectionTitle>
              <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
                {INTERACTION_ORDER.filter(kind => kind !== 'gift').map(kind2 => {
                  const m = INTERACTIONS[kind2]
                  return (
                    <button key={kind2} type="button" onClick={() => open({ kind: 'log', personIds: [p.id], type: kind2 })}
                      className="press flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-fg/95 pl-2.5 pr-3.5 text-[13.5px] font-medium text-ink">
                      <m.icon size={16} weight="bold" /> {m.label}
                    </button>
                  )
                })}
              </div>
              {ints.length ? <Timeline items={ints} people={byId} showPeople={false} allowDelete allowEdit /> : (
                <EmptyLine text={t('Meetings, calls and chats will appear here')} onClick={() => open({ kind: 'log', personIds: [p.id] })} />
              )}
            </>
          )}

          {tab === 'about' && (
            <>
              <FamilySection p={p} />
              <DatesSection p={p} now={now} />
              <PrefsSection p={p} />

              {(p.lookingFor || p.canHelpMe || p.iCanHelp) && (
                <>
                  <SectionTitle>{t('Mutual value')}</SectionTitle>
                  {p.lookingFor && <Group><Row icon={MagnifyingGlassIcon} iconColor="#7fd6ff" label={p.lookingFor} sub={t('Looking for now')} chevron={false} /></Group>}
                  {(p.canHelpMe || p.iCanHelp) && (
                    <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                      {p.canHelpMe && <InfoCard icon={HandshakeIcon} color="#ffd27a" title={t('How they can help')} text={p.canHelpMe} />}
                      {p.iCanHelp && <InfoCard icon={LightbulbIcon} color="#5fe3b0" title={t('How I can help')} text={p.iCanHelp} />}
                    </div>
                  )}
                </>
              )}

              {(p.facts.length > 0 || p.tags.length > 0) && (
                <>
                  <SectionTitle>{t('Memorable')}</SectionTitle>
                  {p.facts.length > 0 && (
                    <Group>
                      {p.facts.map((f, i) => {
                        const I = FACT_ICONS[f.icon] ?? StarFourIcon
                        return <Row key={i} icon={I} iconColor="#ffd27a" label={f.text} chevron={false} />
                      })}
                    </Group>
                  )}
                  {p.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.tags.map(tag => <span key={tag} className="rounded-full border border-line bg-white/[0.05] px-3 py-1.5 text-[13.5px] text-fg-2">{tag}</span>)}
                    </div>
                  )}
                </>
              )}

              {p.giftIdeas && (
                <>
                  <SectionTitle>{t('Gift ideas')}</SectionTitle>
                  <InfoCard icon={GiftIcon} color="#ff8f8f" title={t('What would delight them')} text={p.giftIdeas} />
                </>
              )}

              <SectionTitle>{t('Notes')}</SectionTitle>
              <Notes p={p} />
            </>
          )}

          {tab === 'links' && (
            <>
              <CollectionsSection p={p} />

              {(introducer || p.links.length > 0 || introduced.length > 0) && (
                <>
                  <SectionTitle>{t('Who knows whom')}</SectionTitle>
                  <Group>
                    {introducer && (
                      <Link to={`/person/${introducer.id}`} className="press flex items-center gap-3 px-4 py-3">
                        <Avatar person={introducer} size={38} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium">{fullName(introducer)}</div>
                          <div className="truncate text-[12.5px] text-fg-3">{t('Introduced you')}</div>
                        </div>
                        <UserPlusIcon size={16} className="text-fg-4" />
                      </Link>
                    )}
                    {p.links.map(l => {
                      const o = byId.get(l.personId)
                      if (!o) return null
                      return (
                        <Link key={l.personId} to={`/person/${o.id}`} className="press flex items-center gap-3 px-4 py-3">
                          <Avatar person={o} size={38} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[15px] font-medium">{fullName(o)}</div>
                            <div className="truncate text-[12.5px] text-fg-3">{l.label}</div>
                          </div>
                        </Link>
                      )
                    })}
                    {introduced.map(o => (
                      <Link key={o.id} to={`/person/${o.id}`} className="press flex items-center gap-3 px-4 py-3">
                        <Avatar person={o} size={38} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium">{fullName(o)}</div>
                          <div className="truncate text-[12.5px] text-fg-3">{t('Met through an intro')}</div>
                        </div>
                        <UsersIcon size={16} className="text-fg-4" />
                      </Link>
                    ))}
                  </Group>
                </>
              )}

              {(helpers.length > 0 || helpsOthers.length > 0 || fromReserve.length > 0) && (
                <>
                  <SectionTitle>{t('How you can help each other')}</SectionTitle>
                  <Group>
                    {fromReserve.map(h => (
                      <Row key={h.lead.id} icon={VaultIcon} iconColor="#5fe3b0" label={<span>{t('From the reserve:')}{' '}<b>{fullName(h.lead)}</b></span>} sub={h.reason} onClick={() => open({ kind: 'lead', id: h.lead.id })} />
                    ))}
                    {helpers.map(m => (
                      <Row key={m.b.id} icon={HandshakeIcon} iconColor="#9fdcff" label={<span>{t('Can help:')}{' '}<b>{fullName(m.b)}</b></span>} sub={m.reason}
                        onClick={() => open({ kind: 'intro', aId: m.a.id, bId: m.b.id, reason: m.reason, value: m.value })} />
                    ))}
                    {helpsOthers.slice(0, 2).map(m => (
                      <Row key={m.a.id} icon={UsersIcon} iconColor="#9fdcff" label={<span>{t('Useful for:')}{' '}<b>{fullName(m.a)}</b></span>} sub={t('{firstName} is looking for “{lookingFor}”', { firstName: m.a.firstName, lookingFor: m.a.lookingFor ?? '' })}
                        onClick={() => open({ kind: 'intro', aId: m.a.id, bId: m.b.id, reason: m.reason, value: m.value })} />
                    ))}
                  </Group>
                </>
              )}

              <PersonOrbita personId={p.id} />
              {!introducer && p.links.length === 0 && introduced.length === 0 && helpers.length + helpsOthers.length + fromReserve.length === 0 && (
                <div className="mt-8 text-center text-[13.5px] leading-relaxed text-fg-3">{t('Who this person knows and who introduced you — mark it on the card, “Edit → Connections”, and a graph will appear here.')}</div>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="mt-10 flex justify-center gap-2 text-[13px] text-fg-4">
        {t('Added')}{' '}{dateLong(p.createdAt)}{' '}{t('· updated')}{' '}{ago(p.updatedAt, now)}
      </div>
    </Page>
  )
}
