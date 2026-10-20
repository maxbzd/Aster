import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ClipboardTextIcon, FileArrowUpIcon, StarIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Avatar } from '@/components/Avatar'
import { Chip, PrimaryButton } from '@/components/ui'
import { Field, FormGroup, TextArea, TextInput } from '@/components/forms'
import { ChannelsEditor, Switch, TagInput } from '@/components/reserve/parts'
import { blankLead, saveLead } from '@/data/leads'
import { isNoName, suggestedTags, leadKeys, parseLeadText, type ParsedLead } from '@/data/leadParse'
import { useLead, useLeads, usePeople } from '@/data/hooks'
import { fullName } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import type { Lead } from '@/data/types'
import { t } from '@/i18n'

const uniq = (a: string[]) => [...new Set(a)]
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Добавить / изменить контакт в резерве. Сверху — «умное» поле: вставь что есть, остальное заполнится само. */
export function LeadEditSheet({ id, smart: smart0, keep, onClose }: { id?: string; smart?: string; keep?: { source?: string; tags?: string[] }; onClose: () => void }) {
  const editing = !!id
  const existing = useLead(id)
  const leads = useLeads()
  const people = usePeople()
  const open = useUI(s => s.open)
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [d, setD] = useState<Lead>(() => blankLead({ source: keep?.source, tags: keep?.tags ?? [] }))
  const [smart, setSmart] = useState(smart0 ?? '')
  const [savedCount, setSavedCount] = useState(0)
  const last = useRef<ParsedLead | null>(null)
  const loaded = useRef(false)
  const smartRef = useRef<HTMLTextAreaElement>(null)
  const set = <K extends keyof Lead>(k: K, v: Lead[K]) => setD(cur => ({ ...cur, [k]: v }))

  useEffect(() => { if (existing && !loaded.current) { setD(existing); loaded.current = true } }, [existing])

  // «умное» поле заполняет только то, что пользователь ещё не трогал
  useEffect(() => {
    if (!smart.trim()) { last.current = null; return }
    const p = parseLeadText(smart)
    const prev = last.current
    const base = keep?.tags ?? []
    setD(cur => {
      const next: Lead = { ...cur }
      const fill = <K extends 'firstName' | 'lastName' | 'company' | 'city' | 'why'>(k: K, v: string | undefined) => {
        if (!cur[k] || same(cur[k], prev?.[k] ?? (k === 'firstName' ? '' : undefined))) (next as unknown as Record<string, unknown>)[k] = v || (k === 'firstName' ? '' : undefined)
      }
      fill('firstName', isNoName(p.firstName) ? '' : p.firstName)
      fill('lastName', p.lastName); fill('company', p.company); fill('city', p.city); fill('why', p.why)
      if (!cur.channels.length || same(cur.channels, prev?.channels)) next.channels = p.channels
      if (same(cur.tags, uniq([...base, ...(prev?.tags ?? [])])) || !cur.tags.length) next.tags = uniq([...base, ...p.tags])
      return next
    })
    last.current = p
  }, [smart]) // eslint-disable-line react-hooks/exhaustive-deps

  const dup = useMemo(() => {
    const keys = leadKeys(d)
    if (!keys.length) return null
    const l = (leads ?? []).find(x => x.id !== d.id && leadKeys(x).some(k => keys.includes(k)))
    if (l) return { kind: 'lead' as const, id: l.id, name: fullName(l) }
    const p = (people ?? []).find(x => leadKeys(x).some(k => keys.includes(k)))
    return p ? { kind: 'person' as const, id: p.id, name: fullName(p) } : null
  }, [d, leads, people])

  const sources = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of leads ?? []) if (l.source) m.set(l.source, (m.get(l.source) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0])
  }, [leads])
  const tagSuggestions = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of leads ?? []) for (const item of l.tags) m.set(item, (m.get(item) ?? 0) + 1)
    return uniq([...[...m.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]), ...suggestedTags()])
  }, [leads])

  const canSave = d.firstName.trim().length > 0
  const clean = (): Lead => ({
    ...d,
    firstName: d.firstName.trim(),
    lastName: d.lastName?.trim() || undefined, company: d.company?.trim() || undefined, role: d.role?.trim() || undefined, city: d.city?.trim() || undefined,
    why: d.why?.trim() || undefined, source: d.source?.trim() || undefined, notes: d.notes?.trim() || undefined,
    channels: d.channels.map(c => ({ ...c, value: c.value.trim() })).filter(c => c.value),
  })

  const save = async () => {
    const l = clean()
    await saveLead(l)
    toast(editing ? t('Saved') : t('In reserve: {name}', { name: fullName(l) }))
    onClose()
  }
  const saveAndNext = async () => {
    const l = clean()
    await saveLead(l)
    haptic(12)
    setSavedCount(n => n + 1)
    toast(t('Added: {name}', { name: fullName(l) }))
    setSmart(''); last.current = null
    setD(blankLead({ source: l.source, tags: keep?.tags ?? [] }))
    setTimeout(() => smartRef.current?.focus(), 50)
  }

  const paste = async () => {
    try {
      const value2 = await navigator.clipboard.readText()
      if (value2.trim()) setSmart(value2.trim())
      else toast(t('Clipboard is empty'), 'info')
    } catch { toast(t('No clipboard access — paste the text into the field manually'), 'info') }
  }

  return (
    <Sheet onClose={onClose} tall glow="rgb(95 227 176 / 0.22)"
      title={editing ? t('Edit contact') : t('To reserve')}
      subtitle={editing ? undefined : savedCount ? t('Added this session: {savedCount}', { savedCount }) : t('Someone who may come in handy')}
      footer={
        <div className="flex gap-2">
          {!editing && <button type="button" disabled={!canSave} onClick={saveAndNext} className="press btn-glass h-[52px] shrink-0 px-5 text-[15px] disabled:opacity-40">{t('Another one')}</button>}
          <PrimaryButton className="flex-1" disabled={!canSave} onClick={save}>{t('Save')}</PrimaryButton>
        </div>
      }>
      {!editing && (
        <div className="glass glow-card mt-1 rounded-[24px] p-4" style={{ ['--glow' as string]: 'rgb(95 227 176 / 0.2)', ['--gx' as string]: '0%', ['--gy' as string]: '0%' }}>
          <TextArea ref={smartRef} autoFocus value={smart} onChange={e => setSmart(e.target.value)} rows={3}
            placeholder={t('Paste whatever you have: a link, @handle, a phone number — or everything at once\nJohn Smith — fund, Dubai, @john')} className="!text-[16px]" />
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            {typeof navigator !== 'undefined' && !!navigator.clipboard?.readText && (
              <button type="button" onClick={paste} className="press flex h-8 items-center gap-1.5 rounded-full bg-white/[0.07] px-3 text-[13px] text-fg-2"><ClipboardTextIcon size={14} />{' '}{t('From clipboard')}</button>
            )}
            <button type="button" onClick={() => open({ kind: 'leadImport' })} className="press flex h-8 items-center gap-1.5 rounded-full bg-white/[0.07] px-3 text-[13px] text-fg-2"><FileArrowUpIcon size={14} />{' '}{t('List or file')}</button>
          </div>
        </div>
      )}

      {dup && (
        <button type="button" onClick={() => { if (dup.kind === 'lead') open({ kind: 'lead', id: dup.id }); else { onClose(); nav(`/person/${dup.id}`) } }}
          className="press mt-3 flex w-full items-center gap-3 rounded-[18px] border border-warm/25 bg-warm/[0.07] px-4 py-3 text-left">
          <WarningCircleIcon size={20} className="shrink-0 text-warm" />
          <span className="text-[13.5px] leading-snug text-fg-2">{dup.kind === 'lead' ? <>{t('Looks like')}{' '}<b className="text-fg">{dup.name}</b>{' '}{t('is already in the reserve')}</> : <><b className="text-fg">{dup.name}</b>{' '}{t('is already in your network — no separate card needed')}</>}</span>
        </button>
      )}

      <div className="mt-4 flex items-center gap-4">
        <Avatar person={{ id: d.id, firstName: d.firstName || '?', lastName: d.lastName }} size={68} />
        <div className="min-w-0 flex-1 space-y-1">
          <input value={d.firstName} onChange={e => set('firstName', e.target.value)} placeholder={t('First name')} className="field text-[24px] font-semibold tracking-[-0.02em]" />
          <input value={d.lastName ?? ''} onChange={e => set('lastName', e.target.value)} placeholder={t('Last name')} className="field text-[18px] text-fg-2" />
        </div>
      </div>

      <FormGroup title={t('Why they matter')}>
        <Field label={t('Who this is and how they can help')} hint={t("In your own words — you'll find them by this field later")}>
          <TextArea rows={2} value={d.why ?? ''} onChange={e => set('why', e.target.value)} placeholder={t('A millionaire with a fund in Dubai, can intro me in MENA')} />
        </Field>
        <Field label={t('Where the contact is from')}>
          <TextInput value={d.source ?? ''} onChange={e => set('source', e.target.value)} placeholder={t("Web Summit, a founders' chat, via Alina…")} />
          {sources.length > 0 && !d.source && (
            <div className="-mx-1 mt-2.5 flex flex-wrap gap-1.5">{sources.map(s => <Chip key={s} size="sm" onClick={() => set('source', s)}>{s}</Chip>)}</div>
          )}
        </Field>
      </FormGroup>

      <FormGroup title={t('Tags')}>
        <div className="px-4 py-3.5"><TagInput value={d.tags} onChange={v => set('tags', v)} suggestions={tagSuggestions} /></div>
      </FormGroup>

      <FormGroup title={t('Contacts')}><ChannelsEditor value={d.channels} onChange={v => set('channels', v)} /></FormGroup>

      <FormGroup title={t('More')}>
        <Field label={t('Position')}><TextInput value={d.role ?? ''} onChange={e => set('role', e.target.value)} placeholder={t('Partner, CTO, editor…')} /></Field>
        <Field label={t('Company')}><TextInput value={d.company ?? ''} onChange={e => set('company', e.target.value)} /></Field>
        <Field label={t('City')}><TextInput value={d.city ?? ''} onChange={e => set('city', e.target.value)} /></Field>
        <Field label={t('Note')}><TextArea rows={2} value={d.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder={t('Everything you want to remember')} /></Field>
      </FormGroup>

      <button type="button" onClick={() => set('star', !d.star)} className="press mt-5 flex w-full items-center gap-3 rounded-[18px] border border-line bg-white/[0.04] px-4 py-3.5 text-left">
        <StarIcon size={20} weight={d.star ? 'fill' : 'regular'} className={d.star ? 'text-warm' : 'text-fg-2'} />
        <span className="flex-1">
          <span className="block text-[15px]">{t('Strong contact')}</span>
          <span className="block text-[12.5px] text-fg-3">{t('Ranks higher in the list and in suggestions')}</span>
        </span>
        <Switch on={!!d.star} />
      </button>
      <div className="h-4" />
    </Sheet>
  )
}
