import { useMemo, useState } from 'react'
import { Sheet } from '@/components/Sheet'
import { FormGroup, Field, TextInput } from '@/components/forms'
import { Chip, PrimaryButton } from '@/components/ui'
import { bulkPatchPeople, type BulkPatch } from '@/data/dedupe'
import { addToCollection } from '@/data/collections'
import { CADENCE_OPTIONS } from '@/data/logic'
import { useAllPeople, useCircles, useCollections } from '@/data/hooks'
import { STATUS_META } from './StatusSheet'
import { PALETTES } from '@/lib/colors'
import { useUI } from '@/app/store'
import type { ID, LifeStatus } from '@/data/types'
import { t, tn } from '@/i18n'

type StatusChoice = 'keep' | 'active' | LifeStatus

/** Массовая правка пачки людей: «всем этим сменить город и источник». Показывает итог словами до применения. */
export function BulkSheet({ personIds, onClose }: { personIds: ID[]; onClose: () => void }) {
  const toast = useUI(s => s.toast)
  const people = useAllPeople()
  const circles = useCircles()
  const collections = useCollections()
  const [city, setCity] = useState('')
  const [metPlace, setMetPlace] = useState('')
  const [company, setCompany] = useState('')
  const [tags, setTags] = useState('')
  const [circleIds, setCircleIds] = useState<ID[]>([])
  const [listIds, setListIds] = useState<ID[]>([])
  const [cadence, setCadence] = useState<number | 'keep'>('keep')
  const [status, setStatus] = useState<StatusChoice>('keep')
  const [busy, setBusy] = useState(false)

  const flip = (list: ID[], set: (v: ID[]) => void, id: ID) => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  const tagList = useMemo(() => [...new Set(tags.split(/[,;\n]/).map(tag => tag.trim().replace(/^#/, '')).filter(Boolean))], [tags])

  const lines = useMemo(() => {
    const out: string[] = []
    if (city.trim()) out.push(t('city — {v}', { v: city.trim() }))
    if (metPlace.trim()) out.push(t('how you met — {v}', { v: metPlace.trim() }))
    if (company.trim()) out.push(t('company — {v}', { v: company.trim() }))
    if (tagList.length) out.push(t('tags: {v}', { v: tagList.map(tagList2 => `#${tagList2}`).join(' ') }))
    if (circleIds.length) out.push(t('circles: {v}', { v: circles.filter(c => circleIds.includes(c.id)).map(c => c.name).join(', ') }))
    if (listIds.length) out.push(t('lists: {v}', { v: collections.filter(c => listIds.includes(c.id)).map(c => c.name).join(', ') }))
    if (cadence !== 'keep') out.push(cadence === 0 ? t('rhythm — no reminders') : t('rhythm — {v}', { v: CADENCE_OPTIONS.find(o => o.days === cadence)?.label.toLowerCase() ?? t('every {cadence} days', { cadence }) }))
    if (status !== 'keep') out.push(status === 'active' ? t('status — normal network life') : t('status — {toLowerCase}', { toLowerCase: STATUS_META[status].label.toLowerCase() }))
    return out
  }, [city, metPlace, company, tagList, circleIds, listIds, cadence, status, circles, collections])

  const count = (people ?? []).filter(p => personIds.includes(p.id)).length || personIds.length

  const apply = async () => {
    if (!lines.length || busy) return
    setBusy(true)
    const patch: BulkPatch = {}
    if (city.trim()) patch.city = city
    if (metPlace.trim()) patch.metPlace = metPlace
    if (company.trim()) patch.company = company
    if (tagList.length) patch.addTags = tagList
    if (circleIds.length) patch.addCircleIds = circleIds
    if (cadence !== 'keep') patch.cadenceDays = cadence
    if (status !== 'keep') patch.lifeStatus = status === 'active' ? null : status
    const n = await bulkPatchPeople(personIds, patch)
    for (const id of listIds) await addToCollection(id, { personIds })
    toast(t('Done: updated {pl}', { pl: tn(n, '{n} person', '{n} people') }))
    onClose()
  }

  return (
    <Sheet onClose={onClose} tall title={t('Bulk edit')} subtitle={t('Selected: {pl}', { pl: tn(count, '{n} person', '{n} people') })}
      footer={
        <div>
          {lines.length > 0 && <div className="mb-2.5 text-[13px] leading-snug text-fg-3">{count > 1 ? t('Will change for all {count}', { count }) : t('Will change')}: {lines.join(' · ')}</div>}
          <PrimaryButton className="w-full disabled:opacity-40" disabled={!lines.length || busy} onClick={apply}>{lines.length ? t('Apply to {count}', { count }) : t('Fill in at least one field')}</PrimaryButton>
        </div>
      }>
      <FormGroup>
        <Field label={t('City')}><TextInput value={city} onChange={e => setCity(e.target.value)} placeholder={t("Don't change")} /></Field>
        <Field label={t('Where you met')}><TextInput value={metPlace} onChange={e => setMetPlace(e.target.value)} placeholder={t("Don't change")} /></Field>
        <Field label={t('Company')}><TextInput value={company} onChange={e => setCompany(e.target.value)} placeholder={t("Don't change")} /></Field>
        <Field label={t('Add tags')} hint={t('Comma-separated. Existing tags stay')}><TextInput value={tags} onChange={e => setTags(e.target.value)} placeholder={t('investor, dubai')} /></Field>
      </FormGroup>

      {circles.length > 0 && (
        <Block title={t('Add to circles')}>
          {circles.map(c => <Chip key={c.id} size="sm" color={PALETTES[c.palette].to} active={circleIds.includes(c.id)} onClick={() => flip(circleIds, setCircleIds, c.id)}>{c.emoji} {c.name}</Chip>)}
        </Block>
      )}
      {collections.length > 0 && (
        <Block title={t('Add to lists')}>
          {collections.map(c => <Chip key={c.id} size="sm" color={PALETTES[c.palette].to} active={listIds.includes(c.id)} onClick={() => flip(listIds, setListIds, c.id)}>{c.emoji} {c.name}</Chip>)}
        </Block>
      )}
      <Block title={t('Contact rhythm')}>
        <Chip size="sm" active={cadence === 'keep'} onClick={() => setCadence('keep')}>{t("Don't change")}</Chip>
        {CADENCE_OPTIONS.map(o => <Chip key={o.days} size="sm" active={cadence === o.days} onClick={() => setCadence(o.days)}>{o.short}</Chip>)}
      </Block>
      <Block title={t('Status')}>
        <Chip size="sm" active={status === 'keep'} onClick={() => setStatus('keep')}>{t("Don't change")}</Chip>
        <Chip size="sm" active={status === 'active'} onClick={() => setStatus('active')}>{t('Normal')}</Chip>
        {(Object.keys(STATUS_META) as LifeStatus[]).map(s => <Chip key={s} size="sm" active={status === s} onClick={() => setStatus(s)}>{STATUS_META[s].short}</Chip>)}
      </Block>
      <div className="h-3" />
    </Sheet>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="micro mb-2 px-1 text-fg-3">{title}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}
