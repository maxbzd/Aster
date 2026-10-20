import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { BellSimpleIcon, CheckIcon, XIcon } from '@phosphor-icons/react'
import type { CapturePlan, PersonDraft } from '@/ai/schemas'
import { Avatar } from '@/components/Avatar'
import { Chip, Pill, Segmented } from '@/components/ui'
import { DateField } from '@/components/pickers'
import { CHANNELS, INTERACTIONS } from '@/components/icons'
import { usePeople, useCircles } from '@/data/hooks'
import { CLOSENESS } from '@/data/logic'
import { PALETTES } from '@/lib/colors'
import { dateShort, fromISODate, fullName, inDays, daysBetween } from '@/lib/format'
import type { Closeness } from '@/data/types'
import { SourceBadge } from './Astra'
import { t } from '@/i18n'

const SINGLE: { key: keyof PersonDraft; label: string }[] = [
  { key: 'role', get label() { return t('Role') } },
  { key: 'company', get label() { return t('Company') } },
  { key: 'city', get label() { return t('City') } },
  { key: 'family', get label() { return t('Family') } },
  { key: 'looking_for', get label() { return t('Looking for') } },
  { key: 'can_help', get label() { return t('Strong in') } },
  { key: 'i_can_help', get label() { return t('You can help with') } },
  { key: 'birthday', get label() { return t('Birthday') } },
  { key: 'met_place', get label() { return t('Where you met') } },
  { key: 'gift_ideas', get label() { return t('Gift idea') } },
]
const LISTS: { key: 'facts' | 'interests' | 'topics'; label: string }[] = [
  { key: 'facts', get label() { return t('Facts') } },
  { key: 'interests', get label() { return t('Interests') } },
  { key: 'topics', get label() { return t('Ask next time') } },
]

export interface PlanExtras { circleIds: string[]; closeness: Closeness }

/** «Вот что я поняла» — разобранная заметка, каждую деталь можно поправить или убрать. */
export function PlanReview({ plan, onChange, source, error, extras, onExtras, photos }: {
  plan: CapturePlan
  onChange: (p: CapturePlan) => void
  source: 'ai' | 'local'
  error?: string
  extras: PlanExtras
  onExtras: (e: PlanExtras) => void
  photos?: Record<string, string>
}) {
  const people = usePeople()
  const circles = useCircles()
  const byId = new Map((people ?? []).map(p => [p.id, p]))
  const setPerson = (i: number, d: PersonDraft) => onChange({ ...plan, people: plan.people.map((x, j) => (j === i ? d : x)) })
  const removePerson = (i: number) => {
    const ref = plan.people[i].ref
    onChange({
      ...plan,
      people: plan.people.filter((_, j) => j !== i),
      reminders: plan.reminders.filter(r => r.person_ref !== ref),
      interaction: plan.interaction ? { ...plan.interaction, person_refs: plan.interaction.person_refs.filter(r => r !== ref) } : null,
    })
  }
  const hasNew = plan.people.some(p => !p.existing_id)

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="display text-[30px] leading-tight">{t("Here's what I understood")}</h2>
        <SourceBadge source={source} error={error} />
      </div>
      {plan.summary && <p className="mt-1.5 text-[14.5px] leading-relaxed text-fg-3">{plan.summary}</p>}

      <div className="mt-5 flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {plan.people.map((d, i) => (
            <motion.div key={d.ref} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
              className="glass glow-card overflow-hidden rounded-[26px]" style={{ ['--glow' as string]: d.existing_id ? 'rgb(124 92 255 / 0.25)' : 'rgb(95 227 176 / 0.25)', ['--gx' as string]: '0%', ['--gy' as string]: '0%' }}>
              <div className="flex items-center gap-3 p-4">
                <Avatar person={{ id: d.existing_id ?? d.ref + d.first_name, firstName: d.first_name || '?', lastName: d.last_name ?? undefined, photo: (d.existing_id ? byId.get(d.existing_id)?.photo : undefined) ?? photos?.[d.ref] }} size={48} />
                <div className="min-w-0 flex-1">
                  {d.existing_id ? (
                    <div className="truncate text-[17px] font-semibold">{byId.get(d.existing_id) ? fullName(byId.get(d.existing_id)!) : d.first_name}</div>
                  ) : (
                    <div className="flex gap-2">
                      <input value={d.first_name} onChange={e => setPerson(i, { ...d, first_name: e.target.value })} placeholder={t('First name')} className="field w-1/2 text-[17px] font-semibold" />
                      <input value={d.last_name ?? ''} onChange={e => setPerson(i, { ...d, last_name: e.target.value || null })} placeholder={t('Last name')} className="field w-1/2 text-[17px] text-fg-2" />
                    </div>
                  )}
                  <div className="mt-1">{d.existing_id ? <Pill color="#a796ff">{t("Already in your network — I'll update the card")}</Pill> : <Pill color="#5fe3b0">{t('New person')}</Pill>}</div>
                </div>
                <button type="button" aria-label={t('Remove person')} onClick={() => removePerson(i)} className="press grid h-8 w-8 place-items-center self-start rounded-full bg-white/[0.06] text-fg-3"><XIcon size={13} weight="bold" /></button>
              </div>

              <div className="rows border-t border-line">
                {SINGLE.map(f => {
                  const v = d[f.key] as string | null
                  if (!v) return null
                  return (
                    <FieldRow key={f.key} label={f.label} onRemove={() => setPerson(i, { ...d, [f.key]: null })}>
                      <input value={v} onChange={e => setPerson(i, { ...d, [f.key]: e.target.value })} className="field text-[15px]" />
                    </FieldRow>
                  )
                })}
                {d.introduced_by_id && byId.get(d.introduced_by_id) && (
                  <FieldRow label={t('Introduced by')} onRemove={() => setPerson(i, { ...d, introduced_by_id: null })}>
                    <div className="flex items-center gap-2 text-[15px]"><Avatar person={byId.get(d.introduced_by_id)!} size={22} />{fullName(byId.get(d.introduced_by_id)!)}</div>
                  </FieldRow>
                )}
                {d.channels.length > 0 && (
                  <div className="px-4 py-3">
                    <div className="micro mb-2 text-fg-4">{t('Contacts')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {d.channels.map((c, k) => {
                        const M = CHANNELS[c.type]
                        return (
                          <span key={k} className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.07] pl-2.5 pr-1.5 text-[13.5px]">
                            <M.icon size={14} /> {c.value}
                            <button type="button" aria-label={t('Remove')} onClick={() => setPerson(i, { ...d, channels: d.channels.filter((_, j) => j !== k) })} className="grid h-5 w-5 place-items-center rounded-full text-fg-3 hover:text-fg"><XIcon size={10} weight="bold" /></button>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
                {LISTS.map(f => d[f.key].length > 0 && (
                  <div key={f.key} className="px-4 py-3">
                    <div className="micro mb-2 text-fg-4">{f.label}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {d[f.key].map((item, k) => (
                        <span key={k} className="flex min-h-8 items-center gap-1.5 rounded-full bg-white/[0.07] py-1 pl-3 pr-1.5 text-[13.5px]">
                          {item}
                          <button type="button" aria-label={t('Remove')} onClick={() => setPerson(i, { ...d, [f.key]: d[f.key].filter((_, j) => j !== k) })} className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-fg-3 hover:text-fg"><XIcon size={10} weight="bold" /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {plan.interaction && plan.interaction.person_refs.length > 0 && (() => {
        const it = plan.interaction
        const M = INTERACTIONS[it.type]
        return (
          <div className="glass mt-3 rounded-[24px] p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.06]" style={{ color: M.color }}><M.icon size={19} weight="duotone" /></span>
              <div className="min-w-0 flex-1">
                <div className="micro text-fg-4">{t('To the timeline ·')}{' '}{M.label}</div>
                <input value={it.title} onChange={e => onChange({ ...plan, interaction: { ...it, title: e.target.value } })} className="field mt-1 text-[16px] font-medium" />
              </div>
              <button type="button" aria-label={t("Don't log")} onClick={() => onChange({ ...plan, interaction: null })} className="press grid h-8 w-8 place-items-center self-start rounded-full bg-white/[0.06] text-fg-3"><XIcon size={13} weight="bold" /></button>
            </div>
            <textarea value={it.summary} onChange={e => onChange({ ...plan, interaction: { ...it, summary: e.target.value } })} rows={3} className="field mt-3 resize-none text-[14.5px] leading-relaxed text-fg-2" />
          </div>
        )
      })()}

      {plan.reminders.length > 0 && (
        <div className="mt-3">
          <div className="micro mb-2 px-1 text-fg-3">{t('Reminders')}</div>
          <div className="glass rows overflow-hidden rounded-[24px]">
            {plan.reminders.map((r, i) => {
              const d = daysBetween(Date.now(), fromISODate(r.due_date))
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warm/15 text-warm"><BellSimpleIcon size={17} /></span>
                  <div className="min-w-0 flex-1">
                    <input value={r.text} onChange={e => onChange({ ...plan, reminders: plan.reminders.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} className="field text-[15px]" />
                    <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-fg-3">
                      {inDays(d)} · {dateShort(fromISODate(r.due_date))}
                      <DateField value={r.due_date} onChange={v => v && onChange({ ...plan, reminders: plan.reminders.map((x, j) => (j === i ? { ...x, due_date: v } : x)) })}
                        label={t('Reminder date')} variant="mini" render={() => t('change')} />
                    </div>
                  </div>
                  <button type="button" aria-label={t('Remove')} onClick={() => onChange({ ...plan, reminders: plan.reminders.filter((_, j) => j !== i) })} className="press grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-fg-3"><XIcon size={13} weight="bold" /></button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {hasNew && (
        <div className="mt-5">
          <div className="micro mb-2 px-1 text-fg-3">{t('For new people')}</div>
          <Segmented<Closeness> value={extras.closeness} onChange={v => onExtras({ ...extras, closeness: v })} options={([1, 2, 3, 4] as Closeness[]).map(c => ({ value: c, label: CLOSENESS[c].short }))} />
          {circles.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {circles.map(c => (
                <Chip key={c.id} size="sm" color={PALETTES[c.palette].to} active={extras.circleIds.includes(c.id)}
                  onClick={() => onExtras({ ...extras, circleIds: extras.circleIds.includes(c.id) ? extras.circleIds.filter(x => x !== c.id) : [...extras.circleIds, c.id] })}>
                  {c.emoji} {c.name}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FieldRow({ label, children, onRemove }: { label: string; children: ReactNode; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-mint/90 text-ink"><CheckIcon size={11} weight="bold" /></span>
      <div className="min-w-0 flex-1">
        <div className="micro text-fg-4">{label}</div>
        <div className="mt-1">{children}</div>
      </div>
      <button type="button" aria-label={t("Don't save")} onClick={onRemove} className="press grid h-7 w-7 shrink-0 place-items-center rounded-full text-fg-4 hover:bg-white/[0.06] hover:text-fg"><XIcon size={12} weight="bold" /></button>
    </div>
  )
}

