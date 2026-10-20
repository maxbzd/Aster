import { motion } from 'motion/react'
import { useNavigate } from 'react-router'
import { CheckIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react'
import type { Interaction, Person, Reminder } from '@/data/types'
import { INTERACTIONS } from './icons'
import { Avatar } from './Avatar'
import { ago, dateShort, daysBetween, inDays, timeHM } from '@/lib/format'
import { deleteInteraction, toggleReminder } from '@/data/actions'
import { haptic, useUI } from '@/app/store'
import { t } from '@/i18n'

/** Вертикальная лента событий (Oura timeline). */
export function Timeline({ items, people, showPeople = true, allowDelete, allowEdit = allowDelete }: { items: Interaction[]; people: Map<string, Person>; showPeople?: boolean; allowDelete?: boolean; allowEdit?: boolean }) {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const open = useUI(s => s.open)
  return (
    <div className="relative">
      <div className="absolute bottom-6 left-[19px] top-6 w-px bg-gradient-to-b from-white/15 via-white/10 to-transparent" />
      <div className="flex flex-col gap-2.5">
        {items.map((it, i) => {
          const meta = INTERACTIONS[it.type]
          const ps = it.personIds.map(id => people.get(id)).filter(Boolean) as Person[]
          return (
            <motion.div
              key={it.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0, transition: { delay: Math.min(i, 8) * 0.03 } }}
              className="relative flex gap-3.5"
            >
              <span className="relative z-10 mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-ink-2" style={{ color: meta.color, boxShadow: `0 0 18px -6px ${meta.color}` }}>
                <meta.icon size={18} weight="duotone" />
              </span>
              <div className="glass group min-w-0 flex-1 rounded-[20px] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium leading-snug">{it.title || meta.verb}</div>
                    <div className="mt-0.5 text-[12.5px] text-fg-3">
                      {it.title && it.title !== meta.label ? `${meta.label} · ` : ''}{daysBetween(it.date, Date.now()) < 2 ? `${ago(it.date)}, ${timeHM(it.date)}` : dateShort(it.date)}
                      {it.place ? ` · ${it.place}` : ''}
                      {it.initiator === 'them' ? t(' · their initiative') : it.initiator === 'me' ? t(' · my initiative') : ''}
                    </div>
                  </div>
                  {allowEdit && (
                    <button type="button" aria-label={t('Edit entry')} onClick={() => open({ kind: 'log', interactionId: it.id })} className="hit press -mr-1 grid h-7 w-7 place-items-center rounded-full text-fg-4 opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 max-lg:opacity-60">
                      <PencilSimpleIcon size={14} />
                    </button>
                  )}
                  {allowDelete && (
                    <button type="button" aria-label={t('Delete')} onClick={async () => { await deleteInteraction(it.id); toast(t('Entry deleted'), 'info') }} className="hit press -mr-1 grid h-7 w-7 place-items-center rounded-full text-fg-4 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 max-lg:opacity-60">
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>
                {it.note && <p className="mt-2 text-[14px] leading-relaxed text-fg-2">{it.note}</p>}
                {showPeople && ps.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {ps.map(p => (
                      <button key={p.id} type="button" onClick={() => nav(`/person/${p.id}`)} className="press flex items-center gap-1.5 rounded-full bg-white/[0.06] py-1.5 pl-1.5 pr-3 text-[12.5px] font-medium text-fg-2 hover:text-fg">
                        <Avatar person={p} size={20} />
                        {p.firstName} {p.lastName?.[0] ? `${p.lastName[0]}.` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

export function ReminderRow({ r, person, showPerson = true }: { r: Reminder; person?: Person; showPerson?: boolean }) {
  const nav = useNavigate()
  const d = daysBetween(Date.now(), r.dueAt)
  const overdue = !r.done && r.dueAt < Date.now() && d < 0
  const today = d === 0
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        aria-label={r.done ? t('Undo') : t('Completed')}
        onClick={() => { haptic(12); toggleReminder(r.id) }}
        className={`hit press grid h-7 w-7 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors ${r.done ? 'border-mint bg-mint text-ink' : overdue ? 'border-danger/70' : 'border-white/25'}`}
      >
        {r.done && <CheckIcon size={14} weight="bold" />}
      </button>
      <button type="button" onClick={() => person && nav(`/person/${person.id}`)} className="min-w-0 flex-1 text-left">
        <div className={`text-[15px] leading-snug ${r.done ? 'text-fg-3 line-through' : ''}`}>{r.text}</div>
        <div className={`mt-0.5 text-[12.5px] ${overdue ? 'text-danger' : today ? 'text-warm' : 'text-fg-3'}`}>
          {overdue ? t('overdue · {dateShort}', { dateShort: dateShort(r.dueAt) }) : today ? t('today · {timeHM}', { timeHM: timeHM(r.dueAt) }) : `${inDays(d)} · ${dateShort(r.dueAt)}`}
          {showPerson && person ? ` · ${person.firstName}` : ''}
        </div>
      </button>
      {showPerson && person && <Avatar person={person} size={30} />}
    </div>
  )
}
