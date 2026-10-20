import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Sheet } from '@/components/Sheet'
import { CommitInput } from '@/components/forms'
import { useCircles, usePeople } from '@/data/hooks'
import { db, uid } from '@/data/db'
import { PALETTE_KEYS, PALETTES } from '@/lib/colors'
import type { Circle } from '@/data/types'
import { t } from '@/i18n'

const EMOJIS = ['💼', '✨', '🏡', '📈', '🧭', '🤝', '🌐', '🏃', '🎨', '🎓', '🍷', '✈️', '🎮', '🎵', '❤️', '⚡️']

export function CirclesSheet({ onClose }: { onClose: () => void }) {
  const circles = useCircles()
  const people = usePeople()
  const [editing, setEditing] = useState<string | null>(null)

  const update = (id: string, patch: Partial<Circle>) => db.circles.update(id, patch)
  const add = async () => {
    const id = uid()
    await db.circles.put({ id, name: t('New circle'), emoji: '✨', palette: PALETTE_KEYS[circles.length % PALETTE_KEYS.length], order: circles.length })
    setEditing(id)
  }
  const remove = async (c: Circle) => {
    await db.circles.delete(c.id)
    const ps = await db.people.where('circleIds').equals(c.id).toArray()
    for (const p of ps) await db.people.update(p.id, { circleIds: p.circleIds.filter(x => x !== c.id) })
  }
  const move = async (i: number, dir: -1 | 1) => {
    const a = circles[i]
    const b = circles[i + dir]
    if (!a || !b) return
    await db.circles.update(a.id, { order: b.order })
    await db.circles.update(b.id, { order: a.order })
  }

  return (
    <Sheet onClose={onClose} title={t('Circles')} subtitle={t('Groups of people — each with its own color')} tall>
      <div className="flex flex-col gap-2.5 pt-1">
        {circles.map((c, i) => {
          const pal = PALETTES[c.palette]
          const n = (people ?? []).filter(p => p.circleIds.includes(c.id)).length
          const open = editing === c.id
          return (
            <div key={c.id} className="glass glow-card overflow-hidden rounded-[22px]" style={{ ['--glow' as string]: pal.glow, ['--gx' as string]: '0%', ['--gy' as string]: '0%' }}>
              <div className="flex items-center gap-3 p-3">
                <button type="button" onClick={() => setEditing(open ? null : c.id)} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px]" style={{ background: `linear-gradient(135deg, ${pal.from}88, ${pal.to}33)` }}>{c.emoji}</button>
                <div className="min-w-0 flex-1">
                  <CommitInput value={c.name} aria-label={t('Circle name')} onCommit={name => update(c.id, { name })} className="field text-[16px] font-semibold" />
                  <div className="text-[12.5px] text-fg-3">{n}{' '}{t('ppl')}</div>
                </div>
                <div className="flex items-center gap-0.5 text-fg-3">
                  <button type="button" aria-label={t('Higher')} disabled={i === 0} onClick={() => move(i, -1)} className="press grid h-8 w-8 place-items-center rounded-full disabled:opacity-25"><ArrowUpIcon size={15} /></button>
                  <button type="button" aria-label={t('Lower')} disabled={i === circles.length - 1} onClick={() => move(i, 1)} className="press grid h-8 w-8 place-items-center rounded-full disabled:opacity-25"><ArrowDownIcon size={15} /></button>
                  <button type="button" aria-label={t('Delete circle')} onClick={() => remove(c)} className="press grid h-8 w-8 place-items-center rounded-full hover:text-danger"><TrashIcon size={15} /></button>
                </div>
              </div>
              {open && (
                <div className="border-t border-line px-3 pb-3 pt-3">
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJIS.map(e => (
                      <button key={e} type="button" onClick={() => update(c.id, { emoji: e })} className={`press grid h-9 w-9 place-items-center rounded-full text-[17px] ${c.emoji === e ? 'bg-white/20' : 'bg-white/[0.05]'}`}>{e}</button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {PALETTE_KEYS.map(k => (
                      <button key={k} type="button" aria-label={PALETTES[k].name} onClick={() => update(c.id, { palette: k })}
                        className={`press h-8 w-8 rounded-full ${c.palette === k ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-2' : ''}`}
                        style={{ background: `linear-gradient(135deg, ${PALETTES[k].from}, ${PALETTES[k].to})` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <button type="button" onClick={add} className="press flex h-14 items-center justify-center gap-2 rounded-[22px] border border-dashed border-white/20 text-[15px] text-fg-2">
          <PlusIcon size={16} weight="bold" />{' '}{t('New circle')}
        </button>
      </div>
    </Sheet>
  )
}

