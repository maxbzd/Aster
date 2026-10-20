import { useEffect, useState } from 'react'
import { TrashIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Chip, GlassButton, PrimaryButton } from '@/components/ui'
import { Field, FormGroup, TextArea, TextInput } from '@/components/forms'
import { DateField } from '@/components/pickers'
import { toISODate } from '@/lib/format'
import { db } from '@/data/db'
import { deletePerson, patchPerson } from '@/data/actions'
import { addFamilyMember, RELATION_EMOJI, RELATION_LABEL, RELATION_ORDER } from '@/data/family'
import { useUI } from '@/app/store'
import type { FamilyRelation } from '@/data/types'
import { t } from '@/i18n'

/** Добавить или изменить члена семьи: у него свой день рождения, поэтому это отдельная карточка. */
export function FamilySheet({ ownerId, id, onClose }: { ownerId: string; id?: string; onClose: () => void }) {
  const toast = useUI(s => s.toast)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [relation, setRelation] = useState<FamilyRelation>('child')
  const [birthday, setBirthday] = useState('')
  const [unknownYear, setUnknownYear] = useState(false)
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [ownerName, setOwnerName] = useState('')

  useEffect(() => {
    void db.people.get(ownerId).then(o => setOwnerName(o?.firstName ?? ''))
    if (!id) return
    void db.people.get(id).then(m => {
      if (!m) return
      setFirst(m.firstName); setLast(m.lastName ?? ''); setRelation(m.relation ?? 'relative'); setNotes(m.notes ?? '')
      const b = m.birthday ?? ''
      setUnknownYear(b.startsWith('--'))
      setBirthday(b.startsWith('--') ? `2000${b.slice(1)}` : b)
    })
  }, [id, ownerId])

  const save = async () => {
    if (!first.trim()) return
    const bday = birthday ? (unknownYear ? `--${birthday.slice(5)}` : birthday) : undefined
    if (id) await patchPerson(id, { firstName: first.trim(), lastName: last.trim() || undefined, relation, birthday: bday, notes: notes.trim() || undefined })
    else await addFamilyMember(ownerId, { firstName: first, lastName: last || undefined, relation, birthday: bday, notes: notes.trim() || undefined })
    toast(id ? t('Saved') : t('{v} added to the family', { v: first.trim() }))
    onClose()
  }

  return (
    <Sheet
      onClose={onClose}
      tall
      glow="rgb(255 158 199 / 0.3)"
      title={id ? t('Family member') : t('Add to family')}
      subtitle={ownerName ? t('Family: {ownerName}', { ownerName }) : undefined}
      footer={<PrimaryButton className="w-full" disabled={!first.trim()} onClick={save}>{id ? t('Save') : t('Add')}</PrimaryButton>}
    >
      <div className="micro mb-2 px-1 pt-1 text-fg-3">{t('Who this is')}</div>
      <div className="flex flex-wrap gap-1.5">
        {RELATION_ORDER.map(r => <Chip key={r} size="sm" active={relation === r} onClick={() => setRelation(r)}>{RELATION_EMOJI[r]} {RELATION_LABEL[r]}</Chip>)}
      </div>

      <FormGroup title={t('First name')}>
        <Field label={t('First name')}><TextInput autoFocus={!id} value={first} onChange={e => setFirst(e.target.value)} placeholder={t('Eve')} /></Field>
        <Field label={t('Last name')} hint={t("Can be left empty — a child gets the family's last name")}><TextInput value={last} onChange={e => setLast(e.target.value)} /></Field>
      </FormGroup>

      <div className="mt-5">
        <div className="micro mb-2 px-1 text-fg-3">{t('Birthday')}</div>
        <DateField value={birthday} onChange={setBirthday} label={t('Birthday')} placeholder={t('Pick a date')} max={toISODate(Date.now())} clearable />
        {birthday && (
          <button type="button" onClick={() => setUnknownYear(v => !v)} className="press mt-2.5 flex items-center gap-2 px-1 text-[13.5px] text-fg-2">
            <span className={`grid h-5 w-5 place-items-center rounded-md border ${unknownYear ? 'border-fg bg-fg text-ink' : 'border-white/25'}`}>{unknownYear && '✓'}</span>
            {t('Year unknown — remember only the day and month')}
          </button>
        )}
        <p className="mt-2 px-1 text-[12.5px] leading-relaxed text-fg-4">{t("I'll remind you a week ahead and suggest how to congratulate by writing to")}{' '}{ownerName || t('your loved one')}.</p>
      </div>

      <FormGroup title={t('Note')}>
        <Field label={t('What to remember')}><TextArea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('Favorite toys, school, allergies…')} /></Field>
      </FormGroup>

      {id && (
        <div className="mt-6">
          {!confirm ? (
            <GlassButton className="w-full text-danger" onClick={() => setConfirm(true)}><TrashIcon size={17} className="mr-1.5 inline" />{t('Remove from family')}</GlassButton>
          ) : (
            <PrimaryButton className="w-full !bg-danger text-white" onClick={async () => { await deletePerson(id); toast(t('Removed from family'), 'info'); onClose() }}>{t('Really remove? The card will be deleted')}</PrimaryButton>
          )}
        </div>
      )}
      <div className="h-4" />
    </Sheet>
  )
}
