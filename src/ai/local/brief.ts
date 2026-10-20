import type { Interaction, Person, Reminder } from '@/data/types'
import type { Brief } from '../schemas'
import type { MatchPair } from './matches'
import { CLOSENESS, nextBirthday, warmthOf } from '@/data/logic'
import { INTERACTION_LABEL } from '@/lib/interactionLabels'
import { ago, dateShort, daysBetween, fromISODate, fullName, inDays, lcFirst as lc } from '@/lib/format'
import { t, tn } from '@/i18n'

export function localBrief(p: Person, ints: Interaction[], rems: Reminder[], byId: Map<string, Person>, matches: MatchPair[], now = Date.now()): Brief {
  const w = warmthOf(p, now)
  const since = p.metAt ? fromISODate(p.metAt) : p.createdAt
  const years = daysBetween(since, now) / 365
  const known = years >= 1 ? tn(Math.floor(years), '{n} year', '{n} years') : tn(Math.max(1, Math.round(daysBetween(since, now) / 30)), '{n} month', '{n} months')
  const last = ints.find(i => i.type !== 'note')
  const intro = p.introducedBy ? byId.get(p.introducedBy) : undefined
  const b = nextBirthday(p.birthday, now)
  const helpers = matches.filter(m => m.a.id === p.id)
  const canHelpOthers = matches.filter(m => m.b.id === p.id)

  const ask: string[] = p.topics.filter(topic => !topic.done).map(topic2 => topic2.text.replace(/\?*$/, '?'))
  if (p.lookingFor) ask.push(t('How is this going: {what}?', { what: lc(p.lookingFor) }))
  const kids = p.family?.match(/(?:сын|дочь|дочка|son|daughter)\s+([А-ЯЁA-Z][а-яёa-z]+)/gi)
  if (kids) ask.push(t('How is {names}?', { names: kids.map(k => k.split(' ')[1]).join(` ${t('and')} `) }))
  if (last?.note && /прототип|запуск|раунд|переезд|поездк|конференц|prototype|launch|round|moving|relocat|trip|conference/i.test(last.note)) ask.push(t('What about what we discussed: “{note}”', { note: `${last.note.slice(0, 70)}${last.note.length > 70 ? '…' : ''}` }))

  const details: string[] = []
  if (p.family) details.push(p.family)
  for (const f of p.facts) details.push(f.text)
  if (b && b.days <= 30) details.push(`${t('Birthday {inDays}', { inDays: inDays(b.days) })}${b.turning ? ` — ${t('turns {years}', { years: b.turning })}` : ''}`)
  if (p.tags.length) details.push(t('Interests: {v}', { v: p.tags.join(', ') }))

  const youCan: string[] = []
  if (p.iCanHelp) youCan.push(p.iCanHelp)
  for (const h of helpers) youCan.push(t('Intro: {name} for the request “{need}”', { name: `${fullName(h.b)}${h.b.role ? ` (${h.b.role})` : ''}`, need: p.lookingFor ?? '' }))
  for (const h of canHelpOthers.slice(0, 1)) youCan.push(t('{a} is looking for “{need}” — {b} fits, you could introduce them', { a: h.a.firstName, need: h.a.lookingFor ?? '', b: p.firstName }))

  return {
    headline: `${t('{name} — {closeness}, you have known each other for {known}. Last contact {ago}', { name: p.firstName, closeness: CLOSENESS[p.closeness].name.toLowerCase(), known, ago: ago(p.lastContactAt ?? since, now) })}${w.level === 'cold' || w.level === 'cooling' ? ` — ${t('the connection is cooling')}` : ''}.`,
    who: [
      [p.role, p.company].filter(Boolean).join(` ${t('at')} `),
      p.city ? t('lives in: {city}', { city: p.city }) : '',
      p.metPlace ? t('met: {place}', { place: p.metPlace }) : '',
      intro ? t('via {name}', { name: fullName(intro) }) : '',
    ].filter(Boolean).join(' · ') || t('Not much data yet — fill in the card after a meeting.'),
    last_time: last
      ? `${dateShort(last.date)} — ${INTERACTION_LABEL[last.type].toLowerCase()}: ${last.title ?? ''}${last.note ? `. ${last.note}` : ''}`
      : t('No meeting records yet.'),
    promises_mine: rems.filter(r => !r.done).map(r => r.text),
    promises_theirs: [],
    ask_about: ask.slice(0, 5),
    details: details.slice(0, 6),
    you_can_help: youCan.slice(0, 4),
    careful: [],
    opener: ask[0] ? t('Start with the question: “{q}”', { q: ask[0] }) : last ? t('Recall the last meeting: “{title}” — ask what has changed since.', { title: last.title ?? '' }) : t("Ask what is in focus now and how you can help."),
  }
}
