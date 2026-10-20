import { useEffect, useState } from 'react'
import { TrashIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Chip, GlassButton, PrimaryButton } from '@/components/ui'
import { Field, FormGroup, PersonPicker, TextArea, TextInput } from '@/components/forms'
import { DateField } from '@/components/pickers'
import { INTERACTION_ORDER, INTERACTIONS } from '@/components/icons'
import { addReminder, deleteInteraction, logInteraction, updateInteraction } from '@/data/actions'
import { db } from '@/data/db'
import { usePeople } from '@/data/hooks'
import { DAY, startOfDay, toISODate, fromISODate } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import type { ID, Initiator, InteractionType } from '@/data/types'
import { t } from '@/i18n'

const NEXT = [
  { get label() { return t('No next step') }, days: 0 },
  { get label() { return t('In 3 days') }, days: 3 },
  { get label() { return t('In a week') }, days: 7 },
  { get label() { return t('In 2 weeks') }, days: 14 },
  { get label() { return t('In a month') }, days: 30 },
]

const INITIATOR: Array<{ value: Initiator | undefined; label: string }> = [
  { value: undefined, get label() { return t("Can't remember") } }, { value: 'me', get label() { return t('I did') } }, { value: 'them', get label() { return t('They did') } }, { value: 'both', get label() { return t('We agreed') } },
]
const WITH_INITIATOR: InteractionType[] = ['meeting', 'call', 'message', 'event']

/** Log an interaction, or fix one already logged: the date, participants, type, details. */
export function LogSheet({ personIds: initial = [], type: initialType = 'meeting', interactionId, onClose }: { personIds?: ID[]; type?: InteractionType; interactionId?: ID; onClose: () => void }) {
  const editing = !!interactionId
  const [initiator, setInitiator] = useState<Initiator | undefined>(undefined)
  const [timeOfDay, setTimeOfDay] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [type, setType] = useState<InteractionType>(initialType)
  const [ids, setIds] = useState<ID[]>(initial)
  const [day, setDay] = useState(toISODate(Date.now()))
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [place, setPlace] = useState('')
  const [next, setNext] = useState(0)
  const [nextText, setNextText] = useState('')
  const [pick, setPick] = useState(initial.length === 0 && !interactionId)
  const people = usePeople()
  const toast = useUI(s => s.toast)
  const meta = INTERACTIONS[type]
  const names = (people ?? []).filter(p => ids.includes(p.id)).map(p => p.firstName)

  useEffect(() => {
    if (!interactionId) return
    void db.interactions.get(interactionId).then(it => {
      if (!it) return
      setType(it.type); setIds(it.personIds); setDay(toISODate(it.date)); setTitle(it.title ?? ''); setNote(it.note ?? ''); setPlace(it.place ?? ''); setInitiator(it.initiator)
      setTimeOfDay(it.date - fromISODate(toISODate(it.date)))
    })
  }, [interactionId])

  const today = toISODate(Date.now())
  const yesterday = toISODate(Date.now() - DAY)
  const save = async () => {
    if (!ids.length) return
    const d = fromISODate(day)
    if (interactionId) {
      // the time of day is kept if the day was not changed: editing the date must not "jump" around the timeline
      const date = timeOfDay !== null && day === toISODate(d + timeOfDay) ? d + timeOfDay : d + 12 * 3600_000
      await updateInteraction(interactionId, { personIds: ids, type, date: Math.min(date, Date.now()), title: title.trim() || undefined, note: note.trim() || undefined, place: place.trim() || undefined, initiator })
      haptic(15)
      toast(t('Entry updated'))
      onClose()
      return
    }
    const date = day === today ? Date.now() : d + 12 * 3600_000
    await logInteraction({ personIds: ids, type, date, title: title.trim() || undefined, note: note.trim() || undefined, place: place.trim() || undefined, initiator })
    if (next) {
      for (const pid of ids.slice(0, 1)) {
        await addReminder({ personId: pid, text: nextText.trim() || t('Reconnect'), dueAt: startOfDay() + next * DAY + 10 * 3600_000 })
      }
    }
    haptic(15)
    toast(next ? t('Logged, next step scheduled') : t('Logged to the timeline'))
    onClose()
  }

  return (
    <Sheet
      onClose={onClose}
      tall
      glow={`color-mix(in srgb, ${meta.color} 30%, transparent)`}
      title={editing ? t('Edit entry') : t('Log an interaction')}
      subtitle={names.length ? t('with {v}', { v: names.join(', ') }) : t('A meeting, call, chat or favor')}
      footer={<PrimaryButton className="w-full" disabled={!ids.length} onClick={save}>{t('Save')}</PrimaryButton>}
    >
      <div className="grid grid-cols-4 gap-2 pt-1">
        {INTERACTION_ORDER.map(kind => {
          const m = INTERACTIONS[kind]
          const on = kind === type
          return (
            <button key={kind} type="button" onClick={() => { haptic(5); setType(kind) }}
              className={`press flex flex-col items-center gap-1.5 rounded-[18px] px-1 py-3 text-[12px] font-medium transition-colors ${on ? 'bg-fg text-ink' : 'border border-line bg-white/[0.04] text-fg-2'}`}>
              <m.icon size={22} weight={on ? 'fill' : 'duotone'} style={{ color: on ? undefined : m.color }} />
              {m.label}
            </button>
          )
        })}
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="micro text-fg-3">{t('With whom')}</span>
          {!pick && <button type="button" onClick={() => setPick(true)} className="text-[13px] font-medium text-fg-2">{t('Edit')}</button>}
        </div>
        {pick ? <PersonPicker value={ids} onChange={setIds} /> : (
          <button type="button" onClick={() => setPick(true)} className="press w-full rounded-[18px] border border-line bg-white/[0.04] px-4 py-3 text-left text-[15px]">{names.join(', ')}</button>
        )}
      </div>

      <div className="mt-5">
        <div className="micro mb-2 px-1 text-fg-3">{t('When')}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip size="sm" active={day === today} onClick={() => setDay(today)}>{t('Today')}</Chip>
          <Chip size="sm" active={day === yesterday} onClick={() => setDay(yesterday)}>{t('Yesterday')}</Chip>
          <DateField value={day} max={today} onChange={v => v && setDay(v)} label={t('Another date')} variant="pill" hideYear={day.startsWith(today.slice(0, 4))} />
        </div>
      </div>

      {WITH_INITIATOR.includes(type) && (
        <div className="mt-5">
          <div className="micro mb-2 px-1 text-fg-3">{t('Who started')}</div>
          <div className="flex flex-wrap gap-1.5">
            {INITIATOR.map(o => <Chip key={o.label} size="sm" active={initiator === o.value} onClick={() => setInitiator(o.value)}>{o.label}</Chip>)}
          </div>
        </div>
      )}

      <FormGroup title={t('Details')}>
        <Field label={t('Short')}><TextInput value={title} onChange={e => setTitle(e.target.value)} placeholder={type === 'meeting' ? t('Coffee at Blue Bottle') : type === 'favor_given' ? t('An intro to an investor') : meta.verb} /></Field>
        {(type === 'meeting' || type === 'event') && <Field label={t('Where')}><TextInput value={place} onChange={e => setPlace(e.target.value)} placeholder={t('A place or event')} /></Field>}
        <Field label={t('What you talked about')}><TextArea value={note} onChange={e => setNote(e.target.value)} placeholder={t("News, agreements, what's worth remembering…")} /></Field>
      </FormGroup>

      {!editing && <div className="mt-5">
        <div className="micro mb-2 px-1 text-fg-3">{t('Next step')}</div>
        <div className="flex flex-wrap gap-1.5">
          {NEXT.map(n => <Chip key={n.days} size="sm" active={next === n.days} onClick={() => setNext(n.days)}>{n.label}</Chip>)}
        </div>
        {next > 0 && (
          <input value={nextText} onChange={e => setNextText(e.target.value)} placeholder={t('What to do — e.g. send the deck')} className="mt-2.5 h-12 w-full rounded-[16px] border border-line bg-white/[0.04] px-4 text-[15.5px] outline-none placeholder:text-fg-4" />
        )}
      </div>}
      {editing && (
        <div className="mt-6">
          {!confirmDelete ? (
            <GlassButton className="w-full text-danger" onClick={() => setConfirmDelete(true)}><TrashIcon size={17} className="mr-1.5 inline" />{t('Delete entry')}</GlassButton>
          ) : (
            <PrimaryButton className="w-full !bg-danger text-white" onClick={async () => { await deleteInteraction(interactionId!); toast(t('Entry deleted'), 'info'); onClose() }}>{t('Really delete?')}</PrimaryButton>
          )}
        </div>
      )}
      <div className="h-4" />
    </Sheet>
  )
}
