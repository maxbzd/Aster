import { useEffect, useState } from 'react'
import { TrashIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Field, PersonPicker, TextArea, TextInput } from '@/components/forms'
import { PrimaryButton } from '@/components/ui'
import { db } from '@/data/db'
import { COLLECTION_EMOJI, COLLECTION_PALETTES, COLLECTION_PRESETS, createCollection, deleteCollection, updateCollection } from '@/data/collections'
import { PALETTES } from '@/lib/colors'
import { useUI } from '@/app/store'
import type { ID, PaletteKey } from '@/data/types'
import { t } from '@/i18n'

/** Создание и правка собственного списка: «Для раунда», «Для найма», любой другой. */
export function CollectionEditSheet({ id, addPersonIds, onClose }: { id?: ID; addPersonIds?: ID[]; onClose: () => void }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('⭐')
  const [palette, setPalette] = useState<PaletteKey>('aurora')
  const [note, setNote] = useState('')
  const [members, setMembers] = useState<ID[]>(addPersonIds ?? [])
  const [leadIds, setLeadIds] = useState<ID[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    void db.collections.get(id).then(c => {
      if (!c) return
      setName(c.name); setEmoji(c.emoji); setPalette(c.palette); setNote(c.note ?? ''); setMembers(c.personIds); setLeadIds(c.leadIds)
    })
  }, [id])

  const pal = PALETTES[palette]

  const save = async () => {
    if (!name.trim()) { setError(t('Give the list a name')); return }
    try {
      if (id) {
        await updateCollection(id, { name, emoji, palette, note })
        await db.collections.update(id, { personIds: members, updatedAt: Date.now() })
        toast(t('List saved'))
      } else {
        await createCollection({ name, emoji, palette, note, personIds: members, leadIds })
        toast(t('List “{v}” created', { v: name.trim() }))
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't save"))
    }
  }

  const remove = async () => {
    if (!id) return
    await deleteCollection(id)
    toast(t('List deleted, the people stay in your network'), 'info')
    onClose()
  }

  return (
    <Sheet onClose={onClose} tall glow={`${pal.from}55`} title={id ? t('List') : t('New list')} subtitle={t('Any group of people for your purpose')}
      footer={<PrimaryButton className="w-full" onClick={save}>{id ? t('Save') : t('Create list')}</PrimaryButton>}>
      {!id && !name && (
        <div className="mb-1 pt-1">
          <div className="micro mb-2 px-1 text-fg-3">{t('Quick start')}</div>
          <div className="flex flex-wrap gap-2">
            {COLLECTION_PRESETS.map(p => (
              <button key={p.name} type="button" onClick={() => { setName(p.name); setEmoji(p.emoji); setPalette(p.palette); setNote(p.note) }}
                className="press flex h-10 items-center gap-2 rounded-full border border-line bg-white/[0.05] px-3.5 text-[14px] font-medium text-fg-2">
                <span>{p.emoji}</span>{p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 rounded-[24px] border border-line p-3" style={{ background: `linear-gradient(135deg, ${pal.from}22, ${pal.to}0d)` }}>
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-[26px]" style={{ background: `linear-gradient(135deg, ${pal.from}99, ${pal.to}44)` }}>{emoji}</span>
        <div className="min-w-0 flex-1">
          <TextInput value={name} onChange={e => { setName(e.target.value); setError('') }} placeholder={t('List name')} maxLength={60} aria-label={t('List name')} className="!text-[19px] font-semibold" />
          <div className="text-[12.5px] text-fg-3">{members.length ? t('{count} ppl', { count: members.length }) : t('No one yet')}</div>
        </div>
      </div>
      {error && <div className="mt-2 px-2 text-[13px] text-danger">{error}</div>}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {COLLECTION_EMOJI.map(e => (
          <button key={e} type="button" onClick={() => setEmoji(e)} aria-label={t('Icon {e}', { e })} className={`press grid h-9 w-9 place-items-center rounded-full text-[17px] ${emoji === e ? 'bg-white/20' : 'bg-white/[0.05]'}`}>{e}</button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {COLLECTION_PALETTES.map(k => (
          <button key={k} type="button" aria-label={PALETTES[k].name} onClick={() => setPalette(k)}
            className={`press h-8 w-8 rounded-full ${palette === k ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-2' : ''}`}
            style={{ background: `linear-gradient(135deg, ${PALETTES[k].from}, ${PALETTES[k].to})` }} />
        ))}
      </div>

      <div className="mt-5 overflow-hidden rounded-[22px] border border-line bg-white/[0.04]">
        <Field label={t('What this list is for')}>
          <TextArea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={t('For example: who to invite to dinner in December')} />
        </Field>
      </div>

      <div className="mt-5">
        <div className="micro mb-2 px-1 text-fg-3">{t("Who's on the list")}</div>
        <PersonPicker value={members} onChange={setMembers} placeholder={t('Add people…')} />
      </div>

      {id && (
        <div className="mt-6">
          {!confirmDelete
            ? <button type="button" onClick={() => setConfirmDelete(true)} className="press flex w-full items-center justify-center gap-2 rounded-[18px] py-3 text-[14.5px] text-danger"><TrashIcon size={16} />{' '}{t('Delete list')}</button>
            : <button type="button" onClick={remove} className="press flex w-full items-center justify-center gap-2 rounded-[18px] bg-danger/15 py-3 text-[14.5px] font-semibold text-danger"><TrashIcon size={16} weight="bold" />{' '}{t('Really delete? The people stay')}</button>}
        </div>
      )}
      <div className="h-3" />
    </Sheet>
  )
}
