import { PlusIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { useAllPeople, useCollections } from '@/data/hooks'
import { addToCollection, removeFromCollection } from '@/data/collections'
import { PALETTES } from '@/lib/colors'
import { fullName } from '@/lib/format'
import { haptic, useUI } from '@/app/store'
import type { ID } from '@/data/types'
import { t } from '@/i18n'

/** Put one or several people into lists (or remove them). Applied at once, with no "Save" button. */
export function CollectionPickSheet({ personIds, onClose }: { personIds: ID[]; onClose: () => void }) {
  const collections = useCollections()
  const people = useAllPeople()
  const open = useUI(s => s.open)
  const chosen = (people ?? []).filter(p => personIds.includes(p.id))
  const subtitle = chosen.length === 1 ? fullName(chosen[0]!) : t('{count} ppl: {v}{v2}', { count: personIds.length, v: chosen.slice(0, 3).map(p => p.firstName).join(', '), v2: chosen.length > 3 ? '…' : '' })

  const toggle = async (id: ID, state: 'all' | 'some' | 'none') => {
    haptic(8)
    if (state === 'all') await removeFromCollection(id, { personIds })
    else await addToCollection(id, { personIds })
  }

  return (
    <Sheet onClose={onClose} title={t('To a list')} subtitle={subtitle}>
      <div className="flex flex-col gap-2 pt-1">
        {collections.map(c => {
          const pal = PALETTES[c.palette]
          const inside = personIds.filter(id => c.personIds.includes(id)).length
          const state = inside === personIds.length ? 'all' : inside ? 'some' : 'none'
          return (
            <button key={c.id} type="button" onClick={() => toggle(c.id, state)} aria-pressed={state === 'all'}
              className={`press flex items-center gap-3 rounded-[22px] border p-3 text-left transition-colors ${state === 'none' ? 'border-line bg-white/[0.03]' : 'border-white/25 bg-white/[0.07]'}`}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px]" style={{ background: `linear-gradient(135deg, ${pal.from}88, ${pal.to}33)` }}>{c.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-semibold">{c.name}</span>
                <span className="block text-[12.5px] text-fg-3">{c.personIds.length}{' '}{t('ppl')}{state === 'some' ? t(' · {inside} of {count}', { inside, count: personIds.length }) : ''}</span>
              </span>
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[12px] font-bold ${state === 'all' ? 'border-fg bg-fg text-ink' : state === 'some' ? 'border-fg bg-white/20' : 'border-white/25'}`}>{state === 'all' ? '✓' : state === 'some' ? '–' : ''}</span>
            </button>
          )
        })}
        <button type="button" onClick={() => { onClose(); setTimeout(() => open({ kind: 'collectionEdit', addPersonIds: personIds }), 120) }}
          className="press flex h-14 items-center justify-center gap-2 rounded-[22px] border border-dashed border-white/20 text-[15px] text-fg-2">
          <PlusIcon size={16} weight="bold" />{' '}{t('New list')}
        </button>
      </div>
      <div className="h-3" />
    </Sheet>
  )
}
