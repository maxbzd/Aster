import { AnimatePresence, motion } from 'motion/react'
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  CardsThreeIcon, CheckIcon, CopyIcon, FileCsvIcon, GitMergeIcon, ListChecksIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, SortAscendingIcon, StarIcon,
  UserCirclePlusIcon, UsersThreeIcon, XCircleIcon, XIcon,
} from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { PeopleSwitch } from '@/components/reserve/PeopleSwitch'
import { Avatar } from '@/components/Avatar'
import { Chip, Empty, IconButton, PrimaryButton } from '@/components/ui'
import { useAllPeople, useCircles, useCollections, useLeads, useNow, usePeople } from '@/data/hooks'
import { CLOSENESS, warmthOf, WARMTH_LABEL, type WarmthLevel } from '@/data/logic'
import { collectionToCSV } from '@/data/collections'
import { findDuplicates } from '@/data/dedupe'
import { haystack, personMatches } from '@/data/search'
import { STATUS_META } from '@/sheets/StatusSheet'
import { download } from '@/lib/ics'
import { PALETTES, WARMTH_COLORS } from '@/lib/colors'
import { agoShort, fullName, jobLine } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import type { ID, Person } from '@/data/types'
import { t, tn, collate } from '@/i18n'

type Sort = 'name' | 'stale' | 'recent' | 'close'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'name', get label() { return t('By name') } },
  { value: 'stale', get label() { return t('Longest since contact') } },
  { value: 'recent', get label() { return t('Recent') } },
  { value: 'close', get label() { return t('By closeness') } },
]

export { haystack }

export function People() {
  const people = usePeople()
  const everyone = useAllPeople()
  const circles = useCircles()
  const collections = useCollections()
  const leads = useLeads()
  const now = useNow()
  const open = useUI(s => s.open)
  const toast = useUI(s => s.toast)
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q.trim().toLowerCase())
  const [circle, setCircle] = useState<string | null>(null)
  const [listId, setListId] = useState<string | null>(null)
  const [warmth, setWarmth] = useState<WarmthLevel | null>(null)
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [quietOnly, setQuietOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('name')
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<ID>>(new Set())

  const enriched = useMemo(() => (people ?? []).map(p => ({ p, w: warmthOf(p, now), h: haystack(p) })), [people, now])
  const activeList = collections.find(c => c.id === listId) ?? null
  const dupGroups = useMemo(() => findDuplicates(everyone ?? []).length, [everyone])
  const quietCount = enriched.filter(x => x.p.lifeStatus).length

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const { p } of enriched) for (const c of p.circleIds) m.set(c, (m.get(c) ?? 0) + 1)
    return m
  }, [enriched])

  const list = useMemo(() => {
    let l = enriched
    if (dq) l = l.filter(x => personMatches(dq, x.p, x.h))
    if (circle) l = l.filter(x => x.p.circleIds.includes(circle))
    if (activeList) { const ids = new Set(activeList.personIds); l = l.filter(x => ids.has(x.p.id)) }
    if (warmth) l = l.filter(x => x.w.level === warmth)
    if (pinnedOnly) l = l.filter(x => x.p.pinned)
    if (quietOnly) l = l.filter(x => x.p.lifeStatus)
    const byName = (a: Person, b: Person) => collate(fullName(a), fullName(b))
    return [...l].sort((a, b) => {
      if (sort === 'stale') return b.w.ratio - a.w.ratio
      if (sort === 'recent') return (b.p.lastContactAt ?? 0) - (a.p.lastContactAt ?? 0)
      if (sort === 'close') return a.p.closeness - b.p.closeness || byName(a.p, b.p)
      return byName(a.p, b.p)
    })
  }, [enriched, dq, circle, activeList, warmth, pinnedOnly, quietOnly, sort])

  const groups = useMemo(() => {
    if (sort === 'close') {
      return ([1, 2, 3, 4] as const).map(c => ({ key: CLOSENESS[c].name, items: list.filter(x => x.p.closeness === c) })).filter(g => g.items.length)
    }
    if (sort !== 'name') return [{ key: '', items: list }]
    const m = new Map<string, typeof list>()
    for (const x of list) {
      const k = (x.p.firstName[0] ?? '#').toUpperCase()
      m.set(k, [...(m.get(k) ?? []), x])
    }
    return [...m.entries()].map(([key, items]) => ({ key, items }))
  }, [list, sort])

  const pinned = enriched.filter(x => x.p.pinned)
  const filtered = !!(dq || circle || listId || warmth || pinnedOnly || quietOnly)
  const nextSort = () => setSort(s => SORTS[(SORTS.findIndex(x => x.value === s) + 1) % SORTS.length].value)

  const toggleSelect = () => { haptic(8); setSelecting(v => !v); setPicked(new Set()) }
  const toggle = (id: ID) => { haptic(5); setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  const allShown = list.length > 0 && list.every(x => picked.has(x.p.id))
  const pickAll = () => setPicked(allShown ? new Set() : new Set(list.map(x => x.p.id)))
  const pickedIds = [...picked]

  // выбор не должен пережить фильтры: невидимые люди в массовой правке — это сюрприз
  useEffect(() => { setPicked(s => { const vis = new Set(list.map(x => x.p.id)); const n = new Set([...s].filter(id => vis.has(id))); return n.size === s.size ? s : n }) }, [list])

  const copyNames = async () => {
    if (!activeList) return
    const names = list.map(x => fullName(x.p)).join('\n')
    try { await navigator.clipboard.writeText(names); toast(t('Names copied: {count}', { count: list.length })) } catch { toast(t("Couldn't copy"), 'info') }
  }

  if (!people) return <Page><div /></Page>

  return (
    <Page>
      <PageHeader
        title={t('People')}
        eyebrow={tn(people.length, '{n} person', '{n} people') + t(' in network')}
        actions={<>
          <IconButton icon={ListChecksIcon} label={selecting ? t('Finish selecting') : t('Select several')} onClick={toggleSelect} size={40} active={selecting} />
          <IconButton icon={CardsThreeIcon} label={t('Go through the deck')} onClick={() => nav('/review')} size={40} />
          <IconButton icon={UserCirclePlusIcon} label={t('New person')} onClick={() => open({ kind: 'addPerson' })} size={40} />
        </>}
      />

      <PeopleSwitch value="people" />

      {/* Поиск */}
      <div className="glass mt-4 flex h-12 items-center gap-2.5 rounded-full px-4">
        <MagnifyingGlassIcon size={18} className="text-fg-3" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('Name, company, interest…')}
          className="field h-full text-[15.5px]"
          enterKeyHint="search"
        />
        {q && <button type="button" aria-label={t('Clear')} onClick={() => setQ('')} className="press text-fg-3"><XCircleIcon size={20} weight="fill" /></button>}
      </div>

      {/* Круги */}
      {circles.length > 0 && (
        <div className="-mx-4 mt-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
          <CircleCard label={t('All')} emoji="🌌" count={people.length} glow="rgb(157 140 255 / 0.35)" active={!circle} onClick={() => setCircle(null)} />
          {circles.map(c => (
            <CircleCard key={c.id} label={c.name} emoji={c.emoji} count={counts.get(c.id) ?? 0} glow={PALETTES[c.palette].glow} grad={PALETTES[c.palette]} active={circle === c.id} onClick={() => setCircle(circle === c.id ? null : c.id)} />
          ))}
          <button type="button" onClick={() => open({ kind: 'circles' })} className="press grid w-[76px] shrink-0 place-items-center rounded-[24px] border border-dashed border-white/15 text-[12.5px] text-fg-3">
            {t('Customize')}
          </button>
        </div>
      )}

      {/* Свои списки: «Для раунда», «Для найма» — любые */}
      <div className="-mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        <span className="micro shrink-0 pr-0.5 text-fg-4">{t('Lists')}</span>
        {collections.map(c => (
          <button key={c.id} type="button" onClick={() => { haptic(5); setListId(listId === c.id ? null : c.id) }} aria-pressed={listId === c.id}
            className={`press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full pl-2.5 pr-3.5 text-[13.5px] font-medium transition-colors ${listId === c.id ? 'text-ink' : 'text-fg-2'}`}
            style={listId === c.id
              ? { background: `linear-gradient(135deg, ${PALETTES[c.palette].from}, ${PALETTES[c.palette].to})` }
              : { background: `linear-gradient(135deg, ${PALETTES[c.palette].from}26, ${PALETTES[c.palette].to}10)`, border: `1px solid ${PALETTES[c.palette].from}44` }}>
            <span>{c.emoji}</span>{c.name}<span className="tnum opacity-60">{c.personIds.length}</span>
          </button>
        ))}
        <button type="button" onClick={() => open({ kind: 'collectionEdit' })} className="press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-white/20 px-3.5 text-[13.5px] text-fg-3">
          <PlusIcon size={13} weight="bold" /> {collections.length ? t('List') : t('Create list')}
        </button>
      </div>

      {/* Выбранный список */}
      <AnimatePresence initial={false}>
        {activeList && (
          <motion.div key={activeList.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 rounded-[24px] border border-line p-3.5" style={{ background: `linear-gradient(135deg, ${PALETTES[activeList.palette].from}1f, ${PALETTES[activeList.palette].to}0a)` }}>
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[21px]" style={{ background: `linear-gradient(135deg, ${PALETTES[activeList.palette].from}88, ${PALETTES[activeList.palette].to}33)` }}>{activeList.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[17px] font-semibold">{activeList.name}</div>
                  <div className="truncate text-[12.5px] text-fg-3">{activeList.note || tn(activeList.personIds.length, '{n} person', '{n} people')}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip size="sm" icon={PlusIcon} onClick={() => open({ kind: 'collectionEdit', id: activeList.id })}>{t('Add people')}</Chip>
                <Chip size="sm" icon={PencilSimpleIcon} onClick={() => open({ kind: 'collectionEdit', id: activeList.id })}>{t('Edit')}</Chip>
                <Chip size="sm" icon={CopyIcon} onClick={copyNames}>{t('Copy names')}</Chip>
                <Chip size="sm" icon={FileCsvIcon} onClick={() => { download(`${activeList.name}.csv`, collectionToCSV(activeList, everyone ?? [], leads ?? []), 'text/csv'); toast(t('Spreadsheet downloaded')) }}>{t('To a spreadsheet')}</Chip>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Фильтры */}
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        <Chip size="sm" icon={SortAscendingIcon} onClick={nextSort} active={sort !== 'name'}>{SORTS.find(s => s.value === sort)!.label}</Chip>
        <Chip size="sm" icon={StarIcon} active={pinnedOnly} onClick={() => setPinnedOnly(v => !v)}>{t('Favorites')}</Chip>
        {(['hot', 'warm', 'cooling', 'cold'] as WarmthLevel[]).map(l => (
          <Chip key={l} size="sm" color={WARMTH_COLORS[l]} active={warmth === l} onClick={() => setWarmth(warmth === l ? null : l)}>{WARMTH_LABEL[l]}</Chip>
        ))}
        {quietCount > 0 && <Chip size="sm" active={quietOnly} onClick={() => setQuietOnly(v => !v)}>{t('No reminders ·')}{' '}{quietCount}</Chip>}
      </div>

      {selecting && list.length > 0 && (
        <div className="mt-4 flex items-center justify-between px-1 text-[13.5px] text-fg-3">
          <span className="truncate">{t('Select people for an action')}</span>
          <button type="button" onClick={pickAll} className="press shrink-0 pl-3 font-semibold text-fg-2">{allShown ? t('Deselect all') : t('All · {count}', { count: list.length })}</button>
        </div>
      )}

      {/* Дубли */}
      {dupGroups > 0 && !filtered && !selecting && (
        <button type="button" onClick={() => open({ kind: 'dedupe' })} className="press glass mt-4 flex w-full items-center gap-3 rounded-[22px] px-4 py-3 text-left">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.07] text-warm"><GitMergeIcon size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-medium">{t('Possible duplicates:')}{' '}{dupGroups}</span>
            <span className="block text-[12.5px] text-fg-3">{t('One person on two cards')}</span>
          </span>
          <span className="text-[13px] text-fg-3">{t('Review')}</span>
        </button>
      )}

      {/* Избранные */}
      {!filtered && pinned.length > 0 && sort === 'name' && (
        <div className="mt-6">
          <div className="micro mb-3 px-1 text-fg-3">{t('Favorites')}</div>
          <div className="-mx-4 flex gap-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
            {pinned.map(({ p, w }) => (
              <Link key={p.id} to={`/person/${p.id}`} className="press flex w-[64px] shrink-0 flex-col items-center gap-2">
                <Avatar person={p} size={60} warmth={w.level} ring />
                <span className="w-full truncate text-center text-[12.5px] text-fg-2">{p.firstName}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Список */}
      {people.length === 0 ? (
        <div className="mt-8">
          <Empty icon={UsersThreeIcon} title={t('People will appear here')} text={t('Add the first person or import contacts from your phone in your profile.')} action={<PrimaryButton onClick={() => open({ kind: 'addPerson' })}>{t('Add a person')}</PrimaryButton>} />
        </div>
      ) : list.length === 0 ? (
        <div className="mt-8 text-center text-[15px] text-fg-3">
          {activeList && !dq ? t('No one in this list yet') : <>{t('No one found')}{dq ? t(' matching “{q}”', { q }) : ''}</>}
          {activeList && !dq && <div className="mt-3"><Chip size="sm" icon={PlusIcon} onClick={() => open({ kind: 'collectionEdit', id: activeList.id })}>{t('Add people')}</Chip></div>}
        </div>
      ) : (
        <div className="relative mt-4">
          {groups.map(g => (
            <section key={g.key || 'all'} id={g.key ? `L-${g.key}` : undefined} className="scroll-mt-20">
              {g.key && <div className="micro mb-2 mt-5 px-1 text-fg-3">{g.key}</div>}
              <div className="glass rows overflow-hidden rounded-[24px]">
                {g.items.map(({ p, w }) => <PersonRow key={p.id} p={p} level={w.level} now={now} select={selecting ? { on: picked.has(p.id), toggle: () => toggle(p.id) } : undefined} />)}
              </div>
            </section>
          ))}
          {sort === 'name' && !filtered && !selecting && groups.length > 8 && <AlphaIndex letters={groups.map(g => g.key)} />}
        </div>
      )}
      {selecting && <div className="h-28" />}

      {/* Панель массовых действий */}
      <AnimatePresence>
        {selecting && (
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} transition={{ type: 'spring', stiffness: 460, damping: 36 }}
            className="fixed inset-x-3 bottom-[calc(92px+var(--safe-bottom))] z-40 mx-auto flex max-w-[520px] items-center gap-1.5 rounded-full border border-white/12 bg-[rgb(16_17_28/0.97)] p-1.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.9)] lg:bottom-6 lg:left-[var(--sidebar-w,0px)]">
            <span className="tnum min-w-0 flex-1 truncate pl-3.5 text-[14px] font-medium text-fg-2">{pickedIds.length ? t('{count} selected', { count: pickedIds.length }) : t('Select people')}</span>
            <button type="button" disabled={!pickedIds.length} onClick={() => open({ kind: 'collectionPick', personIds: pickedIds })} className="press h-11 shrink-0 rounded-full bg-white/[0.08] px-3.5 text-[13.5px] font-semibold disabled:opacity-35">{t('To a list')}</button>
            <button type="button" disabled={!pickedIds.length} onClick={() => { open({ kind: 'bulk', personIds: pickedIds }) }} className="press h-11 shrink-0 rounded-full bg-fg px-4 text-[13.5px] font-semibold text-ink disabled:opacity-35">{t('Edit people')}</button>
            <button type="button" aria-label={t('Finish selecting')} onClick={toggleSelect} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg-3"><XIcon size={16} weight="bold" /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  )
}

function CircleCard({ label, emoji, count, glow, active, onClick, grad }: { label: string; emoji: string; count: number; glow: string; active: boolean; onClick: () => void; grad?: { from: string; to: string } }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className={`glass glow-card relative flex h-[104px] w-[124px] shrink-0 flex-col justify-between rounded-[24px] p-3.5 text-left transition-[border-color] ${active ? '!border-white/30' : ''}`}
      style={{ ['--glow' as string]: active ? glow.replace(/0\.\d+\)$/, '0.75)') : glow, ['--gx' as string]: '15%', ['--gy' as string]: '0%' }}
    >
      <span className="grid h-9 w-9 place-items-center rounded-full text-[18px]" style={{ background: grad ? `linear-gradient(135deg, ${grad.from}55, ${grad.to}22)` : 'rgb(255 255 255 / 0.08)' }}>{emoji}</span>
      <span>
        <span className="block truncate text-[14.5px] font-semibold">{label}</span>
        <span className="tnum block text-[12px] text-fg-3">{count}</span>
      </span>
    </motion.button>
  )
}

export function PersonRow({ p, level, now, trailing, select }: { p: Person; level: WarmthLevel; now: number; trailing?: ReactNode; select?: { on: boolean; toggle: () => void } }) {
  const status = p.lifeStatus ? STATUS_META[p.lifeStatus] : null
  const body = (
    <>
      {select && <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors ${select.on ? 'border-fg bg-fg text-ink' : 'border-white/25'}`}>{select.on && <CheckIcon size={13} weight="bold" />}</span>}
      <Avatar person={p} size={46} warmth={status ? undefined : level} ring={!status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-[16px] font-medium">
          {fullName(p)}
          {p.pinned && <StarIcon size={12} weight="fill" className="shrink-0 text-warm" />}
        </div>
        <div className="truncate text-[13px] text-fg-3">{jobLine(p) || p.city || p.metPlace || ' '}</div>
      </div>
      {trailing ?? (status ? (
        <div className="flex shrink-0 items-center gap-1.5 text-[12.5px]" style={{ color: status.color }}><status.icon size={14} weight="fill" />{status.short}</div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 text-[12.5px] text-fg-3">
          <span className="tnum">{agoShort(p.lastContactAt, now)}</span>
          <span className="h-2 w-2 rounded-full" style={{ background: WARMTH_COLORS[level], boxShadow: level === 'hot' || level === 'warm' ? `0 0 8px ${WARMTH_COLORS[level]}` : undefined }} />
        </div>
      ))}
    </>
  )
  return select
    ? <button type="button" onClick={select.toggle} aria-pressed={select.on} className={`press flex w-full items-center gap-3.5 px-4 py-3 text-left ${select.on ? 'bg-white/[0.06]' : 'hover:bg-white/[0.025]'}`}>{body}</button>
    : <Link to={`/person/${p.id}`} className="press flex items-center gap-3.5 px-4 py-3 hover:bg-white/[0.025]">{body}</Link>
}

function AlphaIndex({ letters }: { letters: string[] }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const f = () => setOn(window.scrollY > 380)
    f()
    window.addEventListener('scroll', f, { passive: true })
    return () => window.removeEventListener('scroll', f)
  }, [])
  return (
    <div className={`fixed right-0.5 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-[1px] rounded-full bg-ink/85 py-2 transition-opacity duration-300 lg:right-4 ${on ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
      {letters.map(l => (
        <button key={l} type="button" onClick={() => document.getElementById(`L-${l}`)?.scrollIntoView({ behavior: 'smooth' })} className="w-5 text-center text-[10.5px] font-semibold leading-[15px] text-accent/90 hover:text-fg">
          {l}
        </button>
      ))}
    </div>
  )
}
