import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { CheckCircleIcon, GitMergeIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { Avatar } from '@/components/Avatar'
import { Empty, PrimaryButton } from '@/components/ui'
import { findDuplicates, mergePeople, type DuplicateGroup } from '@/data/dedupe'
import { useAllPeople, useAllInteractions } from '@/data/hooks'
import { fullName, jobLine } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import type { ID, Person } from '@/data/types'
import { t, tn } from '@/i18n'

/** Возможные дубли: выбираешь главную карточку, остальные вливаются в неё вместе с историей. */
export function DedupeSheet({ onClose }: { onClose: () => void }) {
  const all = useAllPeople()
  const groups = useMemo(() => findDuplicates(all ?? []), [all])
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const key = (g: DuplicateGroup) => g.people.map(p => p.id).sort().join('|')
  const visible = groups.filter(g => !skipped.has(key(g)))

  return (
    <Sheet onClose={onClose} title={t('Duplicates')} subtitle={visible.length ? t('These look like the same people: {count}', { count: visible.length }) : t('Card check')}>
      <div className="flex flex-col gap-3 pt-1">
        <AnimatePresence initial={false}>
          {visible.map(g => <Group key={key(g)} group={g} onSkip={() => setSkipped(s => new Set(s).add(key(g)))} />)}
        </AnimatePresence>
        {visible.length === 0 && <Empty icon={CheckCircleIcon} title={t('No duplicates')} text={t('Cards are matched by name with transliteration (Alexey = Алексей), phone, email and handle.')} />}
      </div>
      <div className="h-3" />
    </Sheet>
  )
}

function Group({ group, onSkip }: { group: DuplicateGroup; onSkip: () => void }) {
  const toast = useUI(s => s.toast)
  const interactions = useAllInteractions()
  const [chosen, setKeepId] = useState<ID | null>(null)
  const keepId = chosen ?? richest(group.people, interactions).id
  const [busy, setBusy] = useState(false)
  const others = group.people.filter(p => p.id !== keepId)
  const keep = group.people.find(p => p.id === keepId)!

  const merge = async () => {
    setBusy(true)
    haptic(12)
    await mergePeople(keepId, others.map(p => p.id))
    toast(t('Merged: the card “{name}” remains', { name: fullName(keep) }))
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginTop: -12 }} className="glass overflow-hidden rounded-[24px]">
      <div className="flex items-center gap-2 px-4 pt-3.5 text-[12.5px] text-fg-3"><GitMergeIcon size={15} className="text-fg-2" /> {group.reasons.join(' · ')}</div>
      <div className="px-2 pb-1 pt-1.5">
        {group.people.map(p => {
          const on = p.id === keepId
          const n = interactions.filter(i => i.personIds.includes(p.id)).length
          return (
            <button key={p.id} type="button" onClick={() => setKeepId(p.id)} aria-pressed={on} className="press flex w-full items-center gap-3 rounded-[18px] px-2 py-2 text-left hover:bg-white/[0.04]">
              <Avatar person={p} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{fullName(p)}</span>
                <span className="block truncate text-[12.5px] text-fg-3">{[jobLine(p), p.city, n ? tn(n, '{n} record', '{n} records') : t('no records')].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${on ? 'bg-fg text-ink' : 'border border-line text-fg-3'}`}>{on ? t('Main') : t('Merge in')}</span>
            </button>
          )
        })}
      </div>
      <div className="px-4 pb-1 text-[12.5px] leading-snug text-fg-3">{t('All interaction records, reminders, lists and links will move to the card “')}{fullName(keep)}{t('”. Empty fields will be filled from the others.')}</div>
      <div className="flex gap-2 p-3">
        <button type="button" onClick={onSkip} className="press h-11 flex-1 rounded-full border border-line text-[14.5px] font-medium text-fg-2">{t('Different people')}</button>
        <PrimaryButton className="!h-11 flex-1 !text-[14.5px]" disabled={busy} onClick={merge}>{t('Merge')}{' '}{others.length > 1 ? `(${others.length + 1})` : ''}</PrimaryButton>
      </div>
    </motion.div>
  )
}

/** Главной по умолчанию делаем карточку с большей историей, а при равенстве — ту, что дополнялась позже. */
function richest(people: Person[], interactions: { personIds: ID[] }[]): Person {
  const n = (p: Person) => interactions.filter(i => i.personIds.includes(p.id)).length
  return [...people].sort((a, b) => n(b) - n(a) || b.updatedAt - a.updatedAt)[0]!
}
