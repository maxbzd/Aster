import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CameraIcon, PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Avatar } from '@/components/Avatar'
import { Chip, PrimaryButton, Segmented } from '@/components/ui'
import { Field, FormGroup, PersonPicker, TextArea, TextInput } from '@/components/forms'
import { DateField, SelectField } from '@/components/pickers'
import { CHANNEL_ORDER, CHANNELS, FACT_ICON_KEYS, FACT_ICONS } from '@/components/icons'
import { db } from '@/data/db'
import { blankPerson, savePerson } from '@/data/actions'
import { CADENCE_OPTIONS, CLOSENESS } from '@/data/logic'
import { useCircles, usePeople } from '@/data/hooks'
import { PALETTES } from '@/lib/colors'
import { fileToAvatar, pickFile } from '@/lib/image'
import { monthGen, toISODate } from '@/lib/format'
import { useUI } from '@/app/store'
import type { ChannelType, Closeness, Person } from '@/data/types'
import { t } from '@/i18n'

type SectionKey = 'birthday' | 'city' | 'nickname' | 'family' | 'tags' | 'facts' | 'help' | 'gifts' | 'notes' | 'cadence' | 'story' | 'links'
const EXTRA: { key: SectionKey; label: string; has: (p: Person) => boolean }[] = [
  { key: 'birthday', get label() { return t('Birthday') }, has: p => !!p.birthday },
  { key: 'city', get label() { return t('City') }, has: p => !!p.city },
  { key: 'tags', get label() { return t('Interests') }, has: p => p.tags.length > 0 },
  { key: 'facts', get label() { return t('Facts') }, has: p => p.facts.length > 0 },
  { key: 'family', get label() { return t('Family') }, has: p => !!p.family },
  { key: 'help', get label() { return t('Looking for & useful for') }, has: p => !!(p.canHelpMe || p.iCanHelp || p.lookingFor) },
  { key: 'story', get label() { return t('Meeting story') }, has: p => !!(p.metStory || p.introducedBy) },
  { key: 'cadence', get label() { return t('Contact rhythm') }, has: p => p.cadenceDays !== undefined },
  { key: 'links', get label() { return t('Links') }, has: p => p.links.length > 0 },
  { key: 'gifts', get label() { return t('Gift ideas') }, has: p => !!p.giftIdeas },
  { key: 'nickname', get label() { return t('What to call them') }, has: p => !!p.nickname },
  { key: 'notes', get label() { return t('Note') }, has: p => !!p.notes },
]

const QUICK_CHANNELS: ChannelType[] = ['telegram', 'phone', 'email', 'instagram', 'whatsapp', 'linkedin']

export function PersonSheet({ id, onClose }: { id?: string; onClose: () => void }) {
  const editing = !!id
  const [draft, setDraft] = useState<Person | null>(editing ? null : blankPerson({ metAt: toISODate(Date.now()) }))
  const [shown, setShown] = useState<Set<SectionKey>>(new Set())
  const circles = useCircles()
  const people = usePeople()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)

  useEffect(() => {
    if (!id) return
    db.people.get(id).then(p => {
      if (!p) return
      setDraft(structuredClone(p))
      setShown(new Set(EXTRA.filter(e => e.has(p)).map(e => e.key)))
    })
  }, [id])

  const places = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of people ?? []) if (p.metPlace) m.set(p.metPlace, (m.get(p.metPlace) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 6)
  }, [people])

  if (!draft) return <Sheet onClose={onClose} title={t('Loading')}><div className="h-40" /></Sheet>

  const set = <K extends keyof Person>(k: K, v: Person[K]) => setDraft(d => (d ? { ...d, [k]: v } : d))
  const show = (k: SectionKey) => setShown(s => new Set(s).add(k))

  const save = async (more = false) => {
    if (!draft.firstName.trim()) return
    const clean: Person = {
      ...draft,
      firstName: draft.firstName.trim(),
      lastName: draft.lastName?.trim() || undefined,
      channels: draft.channels.filter(c => c.value.trim()),
      facts: draft.facts.filter(f => f.text.trim()),
      tags: draft.tags.map(tag2 => tag2.trim()).filter(Boolean),
    }
    await savePerson(clean)
    toast(editing ? t('Saved') : t('{firstName} is now in your network ✦', { firstName: clean.firstName }))
    if (more) {
      setDraft(blankPerson({ metAt: draft.metAt, metPlace: draft.metPlace, circleIds: draft.circleIds, closeness: draft.closeness }))
      setShown(new Set())
      return
    }
    onClose()
    if (!editing) nav(`/person/${clean.id}`)
  }

  const missing = EXTRA.filter(e => !shown.has(e.key))

  return (
    <Sheet
      onClose={onClose}
      tall
      title={editing ? t('Edit') : t('New person')}
      subtitle={editing ? undefined : t('Save the essentials in 10 seconds — you can add details later')}
      footer={
        <div className="flex gap-2">
          {!editing && <button type="button" disabled={!draft.firstName.trim()} onClick={() => save(true)} className="press btn-glass h-[52px] px-4 disabled:opacity-40">{t('Add another')}</button>}
          <PrimaryButton className="flex-1" disabled={!draft.firstName.trim()} onClick={() => save()}>{editing ? t('Save') : t('Add to network')}</PrimaryButton>
        </div>
      }
    >
      {/* Photo and name */}
      <div className="flex items-center gap-4 pt-1">
        <button type="button" aria-label={t('Photo')} className="press relative shrink-0" onClick={async () => { const f = await pickFile('image/*'); if (f) set('photo', await fileToAvatar(f)) }}>
          <Avatar person={{ id: draft.id, firstName: draft.firstName || '?', lastName: draft.lastName, photo: draft.photo }} size={84} />
          <span className="absolute -bottom-0.5 -right-0.5 grid h-8 w-8 place-items-center rounded-full border-2 border-ink-2 bg-fg text-ink"><CameraIcon size={15} weight="bold" /></span>
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <input autoFocus={!editing} value={draft.firstName} onChange={e => set('firstName', e.target.value)} placeholder={t('First name')} className="field text-[24px] font-semibold tracking-[-0.02em]" />
          <input value={draft.lastName ?? ''} onChange={e => set('lastName', e.target.value)} placeholder={t('Last name')} className="field text-[18px] text-fg-2" />
        </div>
        {draft.photo && <button type="button" aria-label={t('Remove photo')} onClick={() => set('photo', undefined)} className="press self-start text-fg-4"><XIcon size={16} /></button>}
      </div>

      {/* How you met */}
      <FormGroup title={t('Where you met')}>
        <Field label={t('A place or event')}>
          <TextInput value={draft.metPlace ?? ''} onChange={e => set('metPlace', e.target.value)} placeholder={t("Web Summit, dinner at friends', Telegram…")} />
          {places.length > 0 && !draft.metPlace && (
            <div className="-mx-1 mt-2.5 flex flex-wrap gap-1.5">
              {places.map(pl => <Chip key={pl} size="sm" onClick={() => set('metPlace', pl)}>{pl}</Chip>)}
            </div>
          )}
        </Field>
        <Field label={t('When')}>
          <DateField value={draft.metAt ?? ''} max={toISODate(Date.now())} onChange={v => set('metAt', v || undefined)} label={t('When you met')} placeholder={t('Pick a date')} variant="field" clearable />
        </Field>
      </FormGroup>

      {/* Circles and closeness */}
      <div className="mt-5">
        <div className="micro mb-2 px-1 text-fg-3">{t('Circles')}</div>
        <div className="flex flex-wrap gap-1.5">
          {circles.map(c => (
            <Chip key={c.id} size="sm" color={PALETTES[c.palette].to} active={draft.circleIds.includes(c.id)}
              onClick={() => set('circleIds', draft.circleIds.includes(c.id) ? draft.circleIds.filter(x => x !== c.id) : [...draft.circleIds, c.id])}>
              {c.emoji} {c.name}
            </Chip>
          ))}
        </div>
        <div className="micro mb-2 mt-5 px-1 text-fg-3">{t('Orbit · how close')}</div>
        <Segmented<Closeness>
          value={draft.closeness}
          onChange={v => set('closeness', v)}
          options={([1, 2, 3, 4] as Closeness[]).map(c => ({ value: c, label: CLOSENESS[c].short }))}
        />
        <div className="mt-1.5 px-2 text-[12px] text-fg-4">{t('Default rhythm: every')}{' '}{CLOSENESS[draft.closeness].cadence}{' '}{t('days')}</div>
      </div>

      {/* Work */}
      <FormGroup title={t('What they do')}>
        <Field label={t('Role')}><TextInput value={draft.role ?? ''} onChange={e => set('role', e.target.value)} placeholder={t('Founder, designer, investor…')} /></Field>
        <Field label={t('Company')}><TextInput value={draft.company ?? ''} onChange={e => set('company', e.target.value)} placeholder={t('Where they work')} /></Field>
      </FormGroup>

      {/* Contacts */}
      <FormGroup title={t('Contacts')}>
        {draft.channels.map((c, i) => {
          const meta = CHANNELS[c.type]
          return (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06]"><meta.icon size={17} /></span>
              <div className="min-w-0 flex-1">
                <div className="micro mb-1 text-fg-4">{meta.label}</div>
                <input value={c.value} autoFocus={!c.value} onChange={e => set('channels', draft.channels.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  placeholder={meta.placeholder} className="field text-[16px]" inputMode={c.type === 'phone' || c.type === 'whatsapp' ? 'tel' : c.type === 'email' ? 'email' : 'text'} />
              </div>
              <button type="button" aria-label={t('Delete')} onClick={() => set('channels', draft.channels.filter((_, j) => j !== i))} className="hit press text-fg-4 hover:text-danger"><TrashIcon size={16} /></button>
            </div>
          )
        })}
        <div className="flex flex-wrap gap-1.5 px-3 py-3">
          {(draft.channels.length ? CHANNEL_ORDER : QUICK_CHANNELS).map(item => {
            const m = CHANNELS[item]
            return (
              <button key={item} type="button" onClick={() => set('channels', [...draft.channels, { type: item, value: '' }])}
                className="press flex h-8 items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-3 text-[13px] text-fg-2">
                <PlusIcon size={12} weight="bold" /> {m.label}
              </button>
            )
          })}
        </div>
      </FormGroup>

      {/* Additional sections */}
      <AnimatePresence initial={false}>
        {[...shown].map(k => (
          <motion.div key={k} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <ExtraSection k={k} draft={draft} set={set} />
          </motion.div>
        ))}
      </AnimatePresence>

      {missing.length > 0 && (
        <div className="mt-6">
          <div className="micro mb-2 px-1 text-fg-3">{t('Add')}</div>
          <div className="flex flex-wrap gap-1.5">
            {missing.map(e => (
              <button key={e.key} type="button" onClick={() => show(e.key)} className="press flex h-9 items-center gap-1.5 rounded-full border border-dashed border-white/20 px-3.5 text-[13.5px] text-fg-2 hover:border-white/35 hover:text-fg">
                <PlusIcon size={13} weight="bold" /> {e.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="h-6" />
    </Sheet>
  )
}

function ExtraSection({ k, draft, set }: { k: SectionKey; draft: Person; set: <K extends keyof Person>(k: K, v: Person[K]) => void }) {
  const [tag, setTag] = useState('')
  switch (k) {
    case 'birthday': {
      const m = draft.birthday?.match(/^(\d{4}|--)-(\d{2})-(\d{2})$/)
      const year = m && m[1] !== '--' ? m[1] : ''
      const month = m ? Number(m[2]) : 0
      const day = m ? Number(m[3]) : 0
      const upd = (y: string, mo: number, d: number) => {
        if (!mo || !d) { set('birthday', undefined); return }
        set('birthday', `${/^\d{4}$/.test(y) ? y : '--'}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
      }
      return (
        <FormGroup title={t('Birthday')}>
          <div className="grid grid-cols-[1fr_1.6fr_1.2fr] divide-x divide-line">
            <Field label={t('Day')}>
              <SelectField value={day || ''} onChange={v => upd(year, month || 1, v)} label={t('Birthday: day')} placeholder="—" variant="field" columns={7}
                options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} />
            </Field>
            <Field label={t('Month')}>
              <SelectField value={month || ''} onChange={v => upd(year, v, day || 1)} label={t('Birthday: month')} placeholder="—" variant="field" columns={2}
                options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: monthGen(i) }))} />
            </Field>
            <Field label={t('Year')}>
              <input inputMode="numeric" maxLength={4} value={year} placeholder={t('unknown')} onChange={e => upd(e.target.value.replace(/\D/g, ''), month, day)} className="field text-[16.5px]" />
            </Field>
          </div>
        </FormGroup>
      )
    }
    case 'city':
      return <FormGroup title={t('City')}><Field label={t('Where they live')}><TextInput value={draft.city ?? ''} onChange={e => set('city', e.target.value)} placeholder={t('London, Dubai, Lisbon…')} /></Field></FormGroup>
    case 'nickname':
      return <FormGroup title={t('What to call them')}><Field label={t('Nickname or form of address')}><TextInput value={draft.nickname ?? ''} onChange={e => set('nickname', e.target.value)} placeholder={t('Sasha, Alex, “boss”…')} /></Field></FormGroup>
    case 'family':
      return <FormGroup title={t('Family')}><Field label={t('Close ones')}><TextInput value={draft.family ?? ''} onChange={e => set('family', e.target.value)} placeholder={t('Wife Maria, son Leo (5)')} /></Field></FormGroup>
    case 'tags':
      return (
        <FormGroup title={t('Interests and topics')}>
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-3">
            {draft.tags.map(tag3 => (
              <button key={tag3} type="button" onClick={() => set('tags', draft.tags.filter(x => x !== tag3))} className="press flex h-8 items-center gap-1 rounded-full bg-white/[0.08] pl-3 pr-2 text-[13.5px]">
                {tag3} <XIcon size={11} className="text-fg-3" />
              </button>
            ))}
            <input value={tag} onChange={e => setTag(e.target.value)} placeholder={t('AI, running, wine… Enter')}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && tag.trim()) { e.preventDefault(); set('tags', [...new Set([...draft.tags, tag.trim()])]); setTag('') } }}
              onBlur={() => { if (tag.trim()) { set('tags', [...new Set([...draft.tags, tag.trim()])]); setTag('') } }}
              className="field h-8 min-w-[140px] flex-1 px-1 text-[15px]" />
          </div>
        </FormGroup>
      )
    case 'facts':
      return (
        <FormGroup title={t('Facts — to impress with attention')} action={<button type="button" onClick={() => set('facts', [...draft.facts, { icon: 'sparkle', text: '' }])} className="text-[13px] font-medium text-fg-2">{t('+ fact')}</button>}>
          {(draft.facts.length ? draft.facts : [{ icon: 'sparkle' as const, text: '' }]).map((f, i) => {
            const I = FACT_ICONS[f.icon]
            const facts = draft.facts.length ? draft.facts : [f]
            const cycle = () => {
              const next = FACT_ICON_KEYS[(FACT_ICON_KEYS.indexOf(f.icon) + 1) % FACT_ICON_KEYS.length]
              set('facts', facts.map((x, j) => (j === i ? { ...x, icon: next } : x)))
            }
            return (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <button type="button" onClick={cycle} title={t('Change icon')} className="press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-warm"><I size={17} /></button>
                <input value={f.text} onChange={e => set('facts', facts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder={t('Only drinks filter coffee')} className="field text-[15.5px]" />
                <button type="button" aria-label={t('Delete')} onClick={() => set('facts', facts.filter((_, j) => j !== i))} className="hit press text-fg-4"><XIcon size={14} /></button>
              </div>
            )
          })}
        </FormGroup>
      )
    case 'help':
      return (
        <FormGroup title={t('Looking for & useful for')}>
          <Field label={t("What they're looking for now")} hint={t('Astra will find who in your network to introduce')}><TextArea rows={2} value={draft.lookingFor ?? ''} onChange={e => set('lookingFor', e.target.value)} placeholder={t('A CTO for a startup, an investor, a flat in Lisbon…')} /></Field>
          <Field label={t("What they're strong at · how they can help")}><TextArea rows={2} value={draft.canHelpMe ?? ''} onChange={e => set('canHelpMe', e.target.value)} placeholder={t('Fintech connections, hiring advice…')} /></Field>
          <Field label={t('How I can help')}><TextArea rows={2} value={draft.iCanHelp ?? ''} onChange={e => set('iCanHelp', e.target.value)} placeholder={t('Intros to investors, product feedback…')} /></Field>
        </FormGroup>
      )
    case 'story':
      return (
        <FormGroup title={t('Meeting story')}>
          <Field label={t('How it happened')}><TextArea rows={2} value={draft.metStory ?? ''} onChange={e => set('metStory', e.target.value)} placeholder={t('Got talking in the coffee queue…')} /></Field>
          <div className="px-4 py-3">
            <span className="micro mb-2 block text-fg-3">{t('Who introduced you')}</span>
            <PersonPicker multi={false} exclude={[draft.id]} value={draft.introducedBy ? [draft.introducedBy] : []} onChange={v => set('introducedBy', v[0])} />
          </div>
        </FormGroup>
      )
    case 'cadence':
      return (
        <FormGroup title={t('Contact rhythm')}>
          <div className="flex flex-wrap gap-1.5 px-3 py-3">
            <Chip size="sm" active={draft.cadenceDays === undefined} onClick={() => set('cadenceDays', undefined)}>{t('By orbit')}</Chip>
            {CADENCE_OPTIONS.map(o => <Chip key={o.days} size="sm" active={draft.cadenceDays === o.days} onClick={() => set('cadenceDays', o.days)}>{o.label}</Chip>)}
          </div>
        </FormGroup>
      )
    case 'links':
      return (
        <FormGroup title={t('Connections to other people')}>
          {draft.links.map((l, i) => (
            <LinkRow key={l.personId} personId={l.personId} label={l.label}
              onLabel={v => set('links', draft.links.map((x, j) => (j === i ? { ...x, label: v } : x)))}
              onRemove={() => set('links', draft.links.filter((_, j) => j !== i))} />
          ))}
          <div className="px-3 py-3">
            <PersonPicker multi={false} exclude={[draft.id, ...draft.links.map(l => l.personId)]} value={[]} placeholder={t('Add a connection…')}
              onChange={v => v[0] && set('links', [...draft.links, { personId: v[0], label: t('know each other') }])} />
          </div>
        </FormGroup>
      )
    case 'gifts':
      return <FormGroup title={t('Gift ideas')}><Field label={t('What would delight them')}><TextArea rows={2} value={draft.giftIdeas ?? ''} onChange={e => set('giftIdeas', e.target.value)} placeholder={t('History books, good tea…')} /></Field></FormGroup>
    case 'notes':
      return <FormGroup title={t('Note')}><Field label={t('Everything important')}><TextArea rows={4} value={draft.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder={t("What they're up to, what you talked about…")} /></Field></FormGroup>
  }
}

function LinkRow({ personId, label, onLabel, onRemove }: { personId: string; label: string; onLabel: (v: string) => void; onRemove: () => void }) {
  const people = usePeople()
  const p = people?.find(x => x.id === personId)
  if (!p) return null
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Avatar person={p} size={34} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-medium">{p.firstName} {p.lastName}</div>
        <input value={label} onChange={e => onLabel(e.target.value)} placeholder={t('relation')} className="field text-[13.5px] text-fg-3" />
      </div>
      <button type="button" aria-label={t('Delete connection')} onClick={onRemove} className="press text-fg-4"><XIcon size={14} /></button>
    </div>
  )
}

