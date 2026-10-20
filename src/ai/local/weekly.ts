import type { Interaction, Person, Reminder } from '@/data/types'
import { CONTACT_TYPES } from '@/data/actions'
import { coolingClose, networkHealth, nextBirthday, type BirthdayInfo } from '@/data/logic'
import { DAY, dateShort, fromISODate, startOfDay, toISODate } from '@/lib/format'
import { t, tn } from '@/i18n'
import type { Occasion } from './occasions'
import type { MatchPair } from './matches'

export interface WeeklyData {
  key: string
  range: string
  headline: string
  narrative: string
  stats: { contacts: number; avg: number; newPeople: number; health: number }
  birthdays: { p: Person; b: BirthdayInfo }[]
  cooling: { p: Person; o?: Occasion; days: number }[]
  intros: MatchPair[]
  promises: Reminder[]
  priorities: { personId: string; action: string; why: string }[]
  source: 'ai' | 'local'
}

export function weekKey(now = Date.now()) {
  const d = new Date(startOfDay(now))
  const monday = d.getTime() - ((d.getDay() + 6) % 7) * DAY
  return toISODate(monday)
}

export function localWeekly(people: Person[], ints: Interaction[], rems: Reminder[], occ: Map<string, Occasion>, matches: MatchPair[], now = Date.now()): WeeklyData {
  const active = people.filter(p => !p.archived)
  const contacts = ints.filter(i => CONTACT_TYPES.includes(i.type))
  const week = contacts.filter(i => now - i.date < 7 * DAY).length
  const avg = Math.round((contacts.filter(i => now - i.date < 84 * DAY).length / 12) * 10) / 10
  const newPeople = active.filter(p => now - p.createdAt < 7 * DAY).length
  const health = networkHealth(active, now).score

  const birthdays = active.map(p => ({ p, b: nextBirthday(p.birthday, now) })).filter((x): x is { p: Person; b: BirthdayInfo } => !!x.b && x.b.days <= 7).sort((a, b) => a.b.days - b.b.days)
  const coolingAll = coolingClose(active, now)
  const cooling = coolingAll.slice(0, 4).map(x => ({ p: x.p, o: occ.get(x.p.id), days: x.w.daysSince }))
  const promises = rems.filter(r => !r.done && r.dueAt - now < 7 * DAY).sort((a, b) => a.dueAt - b.dueAt).slice(0, 5)
  const intros = matches.slice(0, 3)

  const priorities: WeeklyData['priorities'] = []
  for (const x of birthdays.slice(0, 2)) priorities.push({ personId: x.p.id, action: t('Congratulate on the birthday'), why: x.b.days === 0 ? t('birthday today') : tn(x.b.days, 'birthday in {n} day', 'birthday in {n} days') })
  for (const x of cooling.slice(0, 2)) priorities.push({ personId: x.p.id, action: t('Write and bring back the warmth'), why: x.o ? x.o.detail : t('{days} d without contact', { days: x.days }) })
  for (const m of intros.slice(0, 1)) priorities.push({ personId: m.a.id, action: t('Introduction: {a} × {b}', { a: m.a.firstName, b: m.b.firstName }), why: m.reason })

  const parts: string[] = []
  if (birthdays.length) parts.push(tn(birthdays.length, '{n} birthday', '{n} birthdays'))
  if (coolingAll.length) parts.push(tn(coolingAll.length, '{n} close connection is cooling', '{n} close connections are cooling'))
  if (matches.length) parts.push(tn(matches.length, '{n} introduction can be arranged', '{n} introductions can be arranged'))
  const headline = week > avg ? t('A strong week — keep the rhythm') : coolingAll.length >= 3 ? t('Time to bring warmth back to your close ones') : birthdays.length ? t('A week of congratulations') : t('A quiet week for new connections')
  const focus = cooling[0]
  const narrative = [
    parts.length ? t('This week: {parts}.', { parts: parts.join(', ') }) : t('Nothing urgent this week — a good moment for new acquaintances.'),
    focus ? `${t('Most important — {name}: {days} d without contact', { name: focus.p.firstName, days: focus.days })}${focus.o && focus.o.kind !== 'silence' ? t(', and there is a reason: {detail}', { detail: focus.o.detail.toLowerCase() }) : ''}.` : '',
    t('Contacts in 7 days: {week} (usually {avg}).', { week, avg }),
  ].filter(Boolean).join(' ')

  const mon = new Date(fromISODate(weekKey(now)))
  const sun = new Date(mon.getTime() + 6 * DAY)
  const range = `${dateShort(mon)} — ${dateShort(sun)}`

  return { key: weekKey(now), range, headline, narrative, stats: { contacts: week, avg, newPeople, health }, birthdays, cooling, intros, promises, priorities, source: 'local' }
}
