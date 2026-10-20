import { useEffect, useState } from 'react'
import { TrashIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Chip, GlassButton, PrimaryButton } from '@/components/ui'
import { Field, FormGroup, TextInput } from '@/components/forms'
import { DateField } from '@/components/pickers'
import { db, uid } from '@/data/db'
import { patchPerson } from '@/data/actions'
import { DATE_KIND_EMOJI, DATE_KIND_LABEL } from '@/data/dates'
import { useUI } from '@/app/store'
import type { DateKind, ImportantDate } from '@/data/types'
import { t } from '@/i18n'

const KINDS: DateKind[] = ['anniversary', 'nameday', 'jubilee', 'event', 'custom']
const REMIND = [{ d: 1, get l() { return t('1 day before') } }, { d: 3, get l() { return t('3 days before') } }, { d: 7, get l() { return t('1 week before') } }, { d: 14, get l() { return t('2 weeks before') } }, { d: 30, get l() { return t('1 month before') } }]

/** Годовщины, именины, юбилеи и любые значимые события в жизни человека. */
export function DateSheet({ personId, id, onClose }: { personId: string; id?: string; onClose: () => void }) {
  const toast = useUI(s => s.toast)
  const [kind, setKind] = useState<DateKind>('anniversary')
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [unknownYear, setUnknownYear] = useState(false)
  const [yearly, setYearly] = useState(true)
  const [remind, setRemind] = useState(3)
  const [name, setName] = useState('')

  useEffect(() => {
    void db.people.get(personId).then(p => {
      setName(p?.firstName ?? '')
      const d = id ? p?.importantDates?.find(x => x.id === id) : undefined
      if (!d) return
      setKind(d.kind); setLabel(d.label); setYearly(d.yearly !== false); setRemind(d.remindDays ?? 3)
      setUnknownYear(d.date.startsWith('--'))
      setDate(d.date.startsWith('--') ? `2000${d.date.slice(1)}` : d.date)
    })
  }, [id, personId])

  const finalLabel = label.trim() || DATE_KIND_LABEL[kind]
  const save = async () => {
    if (!date) return
    const p = await db.people.get(personId)
    if (!p) return
    const next: ImportantDate = { id: id ?? uid(), kind, label: finalLabel, date: unknownYear ? `--${date.slice(5)}` : date, yearly, remindDays: remind }
    const list = p.importantDates ?? []
    await patchPerson(personId, { importantDates: id ? list.map(d => (d.id === id ? next : d)) : [...list, next] })
    toast(t('Date saved'))
    onClose()
  }
  const remove = async () => {
    const p = await db.people.get(personId)
    await patchPerson(personId, { importantDates: (p?.importantDates ?? []).filter(d => d.id !== id) })
    toast(t('Date deleted'), 'info')
    onClose()
  }

  return (
    <Sheet
      onClose={onClose}
      tall
      glow="rgb(255 210 122 / 0.3)"
      title={id ? t('Important date') : t('New important date')}
      subtitle={name ? t('For {name}', { name }) : undefined}
      footer={<PrimaryButton className="w-full" disabled={!date} onClick={save}>{t('Save')}</PrimaryButton>}
    >
      <div className="micro mb-2 px-1 pt-1 text-fg-3">{t('What the date is')}</div>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map(k => <Chip key={k} size="sm" active={kind === k} onClick={() => { setKind(k); if (k === 'nameday' || k === 'jubilee') setYearly(true) }}>{DATE_KIND_EMOJI[k]} {DATE_KIND_LABEL[k]}</Chip>)}
      </div>
      <FormGroup title={t('Title')}>
        <Field label={t('What to call it')}><TextInput value={label} onChange={e => setLabel(e.target.value)} placeholder={kind === 'anniversary' ? t('Wedding anniversary') : kind === 'event' ? t('Move to Lisbon') : DATE_KIND_LABEL[kind]} /></Field>
      </FormGroup>

      <div className="mt-5">
        <div className="micro mb-2 px-1 text-fg-3">{t('When')}</div>
        <DateField value={date} onChange={setDate} label={t('Date')} placeholder={t('Pick a date')} />
        <div className="mt-2.5 flex flex-col gap-2">
          <Toggle on={yearly} onChange={setYearly} label={t('Repeats every year')} />
          {date && <Toggle on={unknownYear} onChange={setUnknownYear} label={t('Year unknown')} />}
        </div>
      </div>

      <div className="mt-5">
        <div className="micro mb-2 px-1 text-fg-3">{t('Remind')}</div>
        <div className="flex flex-wrap gap-1.5">{REMIND.map(r => <Chip key={r.d} size="sm" active={remind === r.d} onClick={() => setRemind(r.d)}>{r.l}</Chip>)}</div>
      </div>

      {id && <div className="mt-6"><GlassButton className="w-full text-danger" onClick={remove}><TrashIcon size={17} className="mr-1.5 inline" />{t('Delete date')}</GlassButton></div>}
      <div className="h-4" />
    </Sheet>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="press flex items-center gap-3 px-1 text-left text-[14.5px] text-fg-2">
      <span className={`relative h-[26px] w-[44px] rounded-full transition-colors ${on ? 'bg-mint' : 'bg-white/15'}`}>
        <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[21px]' : 'translate-x-[3px]'}`} />
      </span>
      {label}
    </button>
  )
}
