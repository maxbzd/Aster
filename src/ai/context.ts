import type { Circle, Interaction, Person, Reminder } from '@/data/types'
import { CLOSENESS, warmthOf, WARMTH_LABEL } from '@/data/logic'
import { INTERACTION_LABEL } from '@/lib/interactionLabels'
import { dateLong, daysBetween, fullName, toISODate, weekday } from '@/lib/format'
import { t } from '@/i18n'

export const todayLine = (now = Date.now()) => t('Today: {weekday}, {dateLong} {getFullYear} ({toISODate}).', { weekday: weekday(now), dateLong: dateLong(now), getFullYear: new Date(now).getFullYear(), toISODate: toISODate(now) })

const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim()

/**
 * A compact index of the network for the model. No phones, emails or notes: only what
 * is needed to match people. The order is stable (by id) so that the cache works.
 */
export function networkIndex(people: Person[], circles: Circle[], now = Date.now()) {
  const cname = new Map(circles.map(c => [c.id, c.name]))
  const lines = [...people]
    .filter(p => !p.archived)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(p => {
      const w = warmthOf(p, now)
      const parts = [
        `id:${p.id}`,
        fullName(p),
        [p.role, p.company].filter(Boolean).join(' @ '),
        p.city,
        p.circleIds.map(id => cname.get(id)).filter(Boolean).join('/'),
        CLOSENESS[p.closeness].name.toLowerCase(),
        p.tags.length ? t('interests: {v}', { v: p.tags.join(', ') }) : '',
        p.lookingFor ? t('looking for: {clean}', { clean: clean(p.lookingFor) }) : '',
        p.canHelpMe ? t('strong at: {clean}', { clean: clean(p.canHelpMe) }) : '',
        p.metPlace ? t('met: {clean}', { clean: clean(p.metPlace) }) : '',
        t('connection: {toLowerCase}, {daysSince} d without contact', { toLowerCase: WARMTH_LABEL[w.level].toLowerCase(), daysSince: w.daysSince }),
      ]
      return parts.filter(Boolean).join(' | ')
    })
  return t("USER'S NETWORK ({count} people)\n{v}", { count: lines.length, v: lines.join('\n') })
}

/** A short list for matching names when parsing notes. */
export function namesIndex(people: Person[]) {
  return t('PEOPLE IN THE NETWORK:\n') + [...people]
    .filter(p => !p.archived)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(p => `id:${p.id} | ${fullName(p)}${p.nickname ? ` («${p.nickname}»)` : ''} | ${[p.role, p.company].filter(Boolean).join(' @ ')} | ${p.city ?? ''}`)
    .join('\n')
}

/** A detailed dossier of one person. */
export function dossier(p: Person, ints: Interaction[], rems: Reminder[], byId: Map<string, Person>, shareNotes: boolean, now = Date.now()) {
  const w = warmthOf(p, now)
  const out: string[] = [
    t('PERSON: {name}{v} (id:{id})', { name: fullName(p), v: p.nickname ? ` («${p.nickname}»)` : '', id: p.id }),
    [p.role, p.company].filter(Boolean).join(' @ ') && t('Work: {v}', { v: [p.role, p.company].filter(Boolean).join(' @ ') }),
    p.city && t('City: {city}', { city: p.city }),
    t('Orbit: {name}; connection: {toLowerCase}, {daysSince} d without contact{v}', { name: CLOSENESS[p.closeness].name, toLowerCase: WARMTH_LABEL[w.level].toLowerCase(), daysSince: w.daysSince, v: w.cadence ? t(', rhythm every {cadence} d', { cadence: w.cadence }) : '' }),
    p.metAt && t('Met: {metAt}{v}', { metAt: p.metAt, v: p.metPlace ? `, ${p.metPlace}` : '' }),
    p.metStory && t('How you met: {clean}', { clean: clean(p.metStory) }),
    p.introducedBy && byId.get(p.introducedBy) && t('Introduced by: {name}', { name: fullName(byId.get(p.introducedBy)!) }),
    p.birthday && t('Birthday: {birthday}', { birthday: p.birthday }),
    p.family && t('Family: {family}', { family: p.family }),
    p.facts.length > 0 && t('Facts: {v}', { v: p.facts.map(f => f.text).join('; ') }),
    p.tags.length > 0 && t('Interests: {v}', { v: p.tags.join(', ') }),
    p.lookingFor && t('Looking for now: {clean}', { clean: clean(p.lookingFor) }),
    p.canHelpMe && t('Strong at / can help with: {clean}', { clean: clean(p.canHelpMe) }),
    p.iCanHelp && t('How I can help: {clean}', { clean: clean(p.iCanHelp) }),
    p.topics.some(topic => !topic.done) && t('Open topics: {v}', { v: p.topics.filter(topic2 => !topic2.done).map(topic3 => topic3.text).join('; ') }),
    p.giftIdeas && t('Gift ideas: {giftIdeas}', { giftIdeas: p.giftIdeas }),
    p.links.length > 0 && t('Connections: {v}', { v: p.links.map(l => `${byId.get(l.personId) ? fullName(byId.get(l.personId)!) : '?'} (${l.label})`).join('; ') }),
    shareNotes && p.notes && t('Notes: {clean}', { clean: clean(p.notes) }),
  ].filter(Boolean) as string[]

  const open = rems.filter(r => !r.done)
  if (open.length) out.push(t('Open reminders: {v}', { v: open.map(r => t('{text} (due {toISODate})', { text: r.text, toISODate: toISODate(r.dueAt) })).join('; ') }))
  if (ints.length) {
    out.push(t('Interaction history (newest first):'))
    for (const it of ints.slice(0, 12)) {
      const note = shareNotes && it.note ? ` — ${clean(it.note)}` : ''
      out.push(t('- {toISODate} ({daysBetween} d ago) · {v}: {v2}{note}', { toISODate: toISODate(it.date), daysBetween: daysBetween(it.date, now), v: INTERACTION_LABEL[it.type], v2: it.title ?? '', note }))
    }
  }
  return out.join('\n')
}

/**
 * The "memory" for the chat: interaction records that may be useful for the answer.
 * For named people their whole history is taken, otherwise recent records across the whole network.
 * Notes go to the model only with the user's consent (shareNotes).
 */
export function memoryBlock(ints: Interaction[], people: Person[], focusIds: string[], shareNotes: boolean, now = Date.now()) {
  const byId = new Map(people.map(p => [p.id, p]))
  const pick = (focusIds.length
    ? ints.filter(i => i.personIds.some(id => focusIds.includes(id)))
    : ints
  ).filter(i => i.type !== 'note' || shareNotes).sort((a, b) => b.date - a.date).slice(0, focusIds.length ? 60 : 40)
  const lines = pick.map(it => {
    const who = it.personIds.map(id => byId.get(id)).filter((p): p is Person => !!p).map(p => `${fullName(p)} (id:${p.id})`).join(', ')
    const note = shareNotes && it.note ? ` — ${clean(it.note).slice(0, 320)}` : ''
    return `- ${toISODate(it.date)} · ${INTERACTION_LABEL[it.type]} · ${who}${it.title ? ` · ${clean(it.title)}` : ''}${note}`
  })
  void now
  return t('MEMORY: interaction records (newest first){v}\n{v2}', { v: shareNotes ? '' : t(" — dates and titles only, the user didn't allow sharing notes"), v2: lines.join('\n') || t('(no records)') })
}
