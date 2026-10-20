import { AnimatePresence, motion } from 'motion/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckIcon, DownloadSimpleIcon, FileArrowUpIcon, ListChecksIcon, MagnifyingGlassIcon, PlusIcon, SortAscendingIcon, StarIcon, TagIcon, TrashIcon, VaultIcon, XCircleIcon,
} from '@phosphor-icons/react'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Avatar } from '@/components/Avatar'
import { Sheet } from '@/components/Sheet'
import { Chip, IconButton, PrimaryButton } from '@/components/ui'
import { AstraStar } from '@/components/astra/Astra'
import { PeopleSwitch } from '@/components/reserve/PeopleSwitch'
import { TagInput, TagPill } from '@/components/reserve/parts'
import { CHANNELS } from '@/components/icons'
import { useReserveMatches } from '@/ai/hooks'
import { filterLeads, leadLine } from '@/ai/local/reserve'
import { suggestedTags } from '@/data/leadParse'
import { addLeads, deleteLeads, leadsToCSV, patchLeads } from '@/data/leads'
import { useLeads } from '@/data/hooks'
import { download } from '@/lib/ics'
import { pickFile } from '@/lib/image'
import { fullName } from '@/lib/format'
import { openChannel, primaryChannel } from '@/lib/contact'
import { haptic, useUI } from '@/app/store'
import type { Lead } from '@/data/types'
import { t, tn, collate } from '@/i18n'

type Sort = 'new' | 'name' | 'strong'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'new', get label() { return t('New') } },
  { value: 'name', get label() { return t('By name') } },
  { value: 'strong', get label() { return t('Strong first') } },
]
const PAGE = 60
const IMPORT_ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt,.vcf,.json,text/csv,text/plain,text/vcard'

export function Reserve() {
  const leads = useLeads()
  const matches = useReserveMatches()
  const open = useUI(s => s.open)
  const toast = useUI(s => s.toast)
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q.trim())
  const [tag, setTag] = useState<string | null>(null)
  const [starOnly, setStarOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('new')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [visible, setVisible] = useState(PAGE)
  const [tagSheet, setTagSheet] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)

  const all = leads ?? []
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of all) for (const item of l.tags) m.set(item, (m.get(item) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || collate(a[0], b[0]))
  }, [all])
  const stars = useMemo(() => all.filter(l => l.star).length, [all])

  const list = useMemo(() => {
    let l = dq ? filterLeads(dq, all) : all
    if (tag) l = l.filter(x => x.tags.includes(tag))
    if (starOnly) l = l.filter(x => x.star)
    const byName = (a: Lead, b: Lead) => collate(fullName(a), fullName(b))
    return [...l].sort((a, b) => {
      if (sort === 'name') return byName(a, b)
      if (sort === 'strong') return Number(!!b.star) - Number(!!a.star) || b.createdAt - a.createdAt
      return b.createdAt - a.createdAt
    })
  }, [all, dq, tag, starOnly, sort])

  useEffect(() => { setVisible(PAGE) }, [dq, tag, starOnly, sort])
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) setVisible(v => v + PAGE) }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [list.length, visible])

  const shown = list.slice(0, visible)
  const groups = useMemo(() => {
    if (sort !== 'name') return [{ key: '', items: shown }]
    const m = new Map<string, Lead[]>()
    for (const l of shown) { const k = (l.firstName[0] ?? '#').toUpperCase(); m.set(k, [...(m.get(k) ?? []), l]) }
    return [...m.entries()].map(([key, items]) => ({ key, items }))
  }, [shown, sort])

  const filtered = !!(dq || tag || starOnly)
  const nextSort = () => setSort(s => SORTS[(SORTS.findIndex(x => x.value === s) + 1) % SORTS.length].value)

  const toggle = (id: string) => { haptic(5); setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  const exitSelect = () => { setSelecting(false); setSelected(new Set()) }

  const pickAndImport = async () => {
    const f = await pickFile(IMPORT_ACCEPT)
    if (f) open({ kind: 'leadImport', file: f })
  }

  const removeSelected = async () => {
    const ids = [...selected]
    const backup = all.filter(l => selected.has(l.id))
    await deleteLeads(ids)
    exitSelect()
    toast(t('Deleted: {count}', { count: ids.length }), 'info', { label: t('Undo'), run: async () => { await addLeads(backup); toast(t('Restored')) } })
  }

  if (!leads) return <Page><div /></Page>

  return (
    <Page>
      <PageHeader
        title={t('Reserve')}
        eyebrow={all.length ? t('{pl} in reserve', { pl: tn(all.length, '{n} contact', '{n} contacts') }) : t('spare contacts')}
        actions={<>
          <IconButton icon={FileArrowUpIcon} label={t('Upload a list')} onClick={() => open({ kind: 'leadImport' })} size={40} />
          <IconButton icon={PlusIcon} label={t('Add a contact')} onClick={() => open({ kind: 'leadEdit' })} size={40} />
        </>}
      />
      <PeopleSwitch value="reserve" />

      {all.length === 0 ? (
        <div className="glass glow-card mt-5 flex flex-col items-center rounded-[30px] px-6 py-10 text-center" style={{ ['--glow' as string]: 'rgb(95 227 176 / 0.28)', ['--gx' as string]: '50%', ['--gy' as string]: '0%' }}>
          <span className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-white/[0.06] text-mint"><VaultIcon size={32} weight="duotone" /></span>
          <div className="display text-[28px] leading-tight">{t('People in reserve')}</div>
          <p className="mt-2 max-w-[310px] text-[14.5px] leading-relaxed text-fg-3">
            {t("A strong person from a chat, a millionaire from a conference, someone's recommendation — until you know what to do with them, just save them. When needed you'll find them in a second, and Astra will suggest who to write to and what.")}
          </p>
          <div className="mt-6 flex w-full max-w-[320px] flex-col gap-2.5">
            <PrimaryButton onClick={pickAndImport}><FileArrowUpIcon size={18} weight="bold" />{' '}{t('Upload a list or file')}</PrimaryButton>
            <button type="button" onClick={() => open({ kind: 'leadImport' })} className="press btn-glass h-[52px]">{t('Paste text')}</button>
            <button type="button" onClick={() => open({ kind: 'leadEdit' })} className="press btn-glass h-[52px]"><PlusIcon size={17} weight="bold" />{' '}{t('Add one')}</button>
          </div>
          <p className="mt-5 text-[12.5px] leading-relaxed text-fg-4">{t('Works with Excel and Google Sheets, CSV, .vcf contacts, or just a profile link or @handle.')}</p>
        </div>
      ) : (
        <>
          {/* Useful right now */}
          {!filtered && matches.length > 0 && (
            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2 px-1">
                <AstraStar size={15} />
                <span className="micro text-fg-3">{t('Useful right now')}</span>
              </div>
              <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
                {matches.map(m => (
                  <button key={m.lead.id} type="button" onClick={() => open({ kind: 'lead', id: m.lead.id })}
                    className="press glass glow-card flex w-[268px] shrink-0 snap-start flex-col gap-3 rounded-[24px] p-4 text-left"
                    style={{ ['--glow' as string]: 'rgb(255 200 150 / 0.22)', ['--gx' as string]: '100%', ['--gy' as string]: '0%' }}>
                    <p className="text-[13.5px] leading-snug text-fg-2"><b className="text-fg">{m.person.firstName}</b>{' '}{t('is looking for “')}{m.person.lookingFor}»</p>
                    <div className="flex items-center gap-3">
                      <Avatar person={m.lead} size={40} />
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-medium">{fullName(m.lead)}</div>
                        <div className="truncate text-[12.5px] text-fg-3">{leadLine(m.lead)}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="glass mt-5 flex h-12 items-center gap-2.5 rounded-full px-4">
            <MagnifyingGlassIcon size={18} className="text-fg-3" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Who, what they do, where from…')} className="field h-full text-[15.5px]" enterKeyHint="search" />
            {q && <button type="button" aria-label={t('Clear')} onClick={() => setQ('')} className="press text-fg-3"><XCircleIcon size={20} weight="fill" /></button>}
          </div>

          {/* Tags */}
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
            <Chip size="sm" active={!tag && !starOnly} onClick={() => { setTag(null); setStarOnly(false) }}>{t('All ·')}{' '}{all.length}</Chip>
            {stars > 0 && <Chip size="sm" icon={StarIcon} active={starOnly} onClick={() => setStarOnly(v => !v)}>{t('Strong ·')}{' '}{stars}</Chip>}
            {tagCounts.slice(0, 16).map(([item2, n]) => <Chip key={item2} size="sm" active={tag === item2} onClick={() => setTag(tag === item2 ? null : item2)}>{item2} · {n}</Chip>)}
          </div>

          <div className="-mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
            <Chip size="sm" icon={SortAscendingIcon} onClick={nextSort} active={sort !== 'new'}>{SORTS.find(s => s.value === sort)!.label}</Chip>
            <Chip size="sm" icon={ListChecksIcon} active={selecting} onClick={() => (selecting ? exitSelect() : setSelecting(true))}>{selecting ? t('Done') : t('Select')}</Chip>
            {selecting && <Chip size="sm" onClick={() => setSelected(new Set(list.map(l => l.id)))}>{t('All results ·')}{' '}{list.length}</Chip>}
          </div>

          {/* List */}
          {list.length === 0 ? (
            <div className="mt-10 text-center">
              <div className="text-[15px] text-fg-3">{t('No one found')}{dq ? t(' matching “{dq}”', { dq }) : ''}</div>
              <button type="button" onClick={() => useUI.getState().setSearch(true)} className="press mt-3 inline-flex items-center gap-2 text-[14px] text-fg-2 hover:text-fg"><AstraStar size={14} />{' '}{t('Ask Astra by meaning')}</button>
            </div>
          ) : (
            <div className="mt-4">
              {groups.map(g => (
                <section key={g.key || 'all'}>
                  {g.key && <div className="micro mb-2 mt-5 px-1 text-fg-3">{g.key}</div>}
                  <div className="glass rows overflow-hidden rounded-[24px]">
                    {g.items.map(l => <LeadRow key={l.id} l={l} selecting={selecting} selected={selected.has(l.id)} onTap={() => (selecting ? toggle(l.id) : open({ kind: 'lead', id: l.id }))} />)}
                  </div>
                </section>
              ))}
              {visible < list.length && <div ref={sentinel} className="py-6 text-center text-[13px] text-fg-4">{t('More')}{' '}{list.length - visible}…</div>}
            </div>
          )}

          <div className="mt-8 flex justify-center">
            <button type="button" onClick={() => { download('aster-reserve.csv', leadsToCSV(all), 'text/csv'); toast(t('Reserve exported to .csv')) }} className="press flex items-center gap-1.5 py-2.5 text-[13px] text-fg-3 hover:text-fg-2"><DownloadSimpleIcon size={15} />{' '}{t('Download the whole reserve (.csv)')}</button>
          </div>
        </>
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {selecting && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ type: 'spring', stiffness: 460, damping: 36 }}
            className="fixed inset-x-0 bottom-[calc(92px+var(--safe-bottom))] z-40 flex justify-center px-4 lg:bottom-8 lg:pl-[264px]">
            <div className="glass-strong flex h-14 items-center gap-1 rounded-full pl-5 pr-1.5">
              <span className="tnum mr-2 text-[14.5px] font-medium">{selected.size ? t('Selected {size}', { size: selected.size }) : t('Choose people')}</span>
              <BarBtn icon={TagIcon} label={t('Tag')} disabled={!selected.size} onClick={() => setTagSheet(true)} />
              <BarBtn icon={StarIcon} label={t('Strong ones')} disabled={!selected.size} onClick={async () => { await patchLeads([...selected], () => ({ star: true })); toast(t('Strong contacts: +{size}', { size: selected.size })); exitSelect() }} />
              <BarBtn icon={TrashIcon} label={t('Delete')} danger disabled={!selected.size} onClick={removeSelected} />
              <button type="button" aria-label={t('Done')} onClick={exitSelect} className="press grid h-11 w-11 place-items-center rounded-full bg-fg text-ink"><CheckIcon size={18} weight="bold" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {tagSheet && <BulkTagSheet count={selected.size} suggestions={[...tagCounts.map(x => x[0]), ...suggestedTags()]} onClose={() => setTagSheet(false)}
          onApply={async tags => { await patchLeads([...selected], l => ({ tags: [...new Set([...l.tags, ...tags])] })); toast(t('Tags added: {size}', { size: selected.size })); setTagSheet(false); exitSelect() }} />}
      </AnimatePresence>
    </Page>
  )
}

function BarBtn({ icon: I, label, onClick, danger, disabled }: { icon: typeof TagIcon; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={`press grid h-11 w-11 place-items-center rounded-full transition-opacity disabled:opacity-30 ${danger ? 'text-danger' : 'text-fg'}`}>
      <I size={20} />
    </button>
  )
}

function LeadRow({ l, selecting, selected, onTap }: { l: Lead; selecting: boolean; selected: boolean; onTap: () => void }) {
  const ch = primaryChannel(l)
  const Icon = ch ? CHANNELS[ch.type].icon : null
  return (
    <div className={`flex items-center transition-colors hover:bg-white/[0.025] ${selected ? 'bg-mint/[0.06]' : ''}`} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 76px' }}>
      <button type="button" onClick={onTap} aria-pressed={selecting ? selected : undefined} className="press flex min-w-0 flex-1 items-center gap-3.5 py-3 pl-4 pr-2 text-left">
        <Avatar person={l} size={46} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-[16px] font-medium">
            {fullName(l)}
            {l.star && <StarIcon size={12} weight="fill" className="shrink-0 text-warm" />}
          </div>
          <div className="truncate text-[13px] text-fg-3">{leadLine(l) || ' '}</div>
          {l.tags.length > 0 && <div className="mt-1 flex gap-1 overflow-hidden">{l.tags.slice(0, 3).map(tag2 => <TagPill key={tag2} tag={tag2} />)}</div>}
        </div>
        {selecting && <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${selected ? 'border-mint bg-mint text-ink' : 'border-white/25'}`}>{selected && <CheckIcon size={13} weight="bold" />}</span>}
      </button>
      {!selecting && ch && Icon && (
        <button type="button" aria-label={CHANNELS[ch.type].label} onClick={() => { haptic(8); openChannel(ch) }} className="press mr-4 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.06] text-fg-2 hover:text-fg">
          <Icon size={18} />
        </button>
      )}
      {!selecting && !ch && <span className="mr-4 w-10 shrink-0" />}
    </div>
  )
}

function BulkTagSheet({ count, suggestions, onApply, onClose }: { count: number; suggestions: string[]; onApply: (value2: string[]) => void; onClose: () => void }) {
  const [tags, setTags] = useState<string[]>([])
  return (
    <Sheet onClose={onClose} title={t('Add a tag')} subtitle={`${tn(count, '{n} contact', '{n} contacts')}`}
      footer={<PrimaryButton className="w-full" disabled={!tags.length} onClick={() => onApply(tags)}>{t('Add')}</PrimaryButton>}>
      <div className="pt-1"><TagInput value={tags} onChange={setTags} suggestions={suggestions} placeholder={t('For example: Dubai… Enter')} /></div>
      <div className="h-4" />
    </Sheet>
  )
}
