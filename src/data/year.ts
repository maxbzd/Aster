import type { Interaction, Person } from './types'
import { reciprocity, warmthHistory, type Reciprocity } from './history'
import { cadenceOf } from './logic'
import { DAY } from '@/lib/format'
import { t, msg, collate } from '@/i18n'

const CONTACT = new Set(['meeting', 'call', 'message', 'event', 'favor_given', 'favor_got', 'gift'])

const MONTHS = [msg('January'), msg('February'), msg('March'), msg('April'), msg('May'), msg('June'), msg('July'), msg('August'), msg('September'), msg('October'), msg('November'), msg('December')]

export interface YearReview {
  year: number
  /** the year is not over yet */
  partial: boolean
  hasData: boolean
  total: number
  meetings: number
  events: number
  calls: number
  messages: number
  favors: number
  uniquePeople: number
  newPeople: Person[]
  topPeople: { person: Person; count: number }[]
  cities: { city: string; count: number }[]
  warmest: { person: Person; score: number; count: number }[]
  lost: { person: Person; lastAt: number | null; reason: 'silent' | 'status' }[]
  reciprocity: Reciprocity
  monthly: number[]
  busiestMonth: { index: number; name: string; count: number } | null
  /** the longest run of consecutive weeks in which you were in touch with someone */
  weekStreak: number
  /** change in the number of contacts against last year, % (null: there is no last year) */
  deltaPct: number | null
  title: string
  subtitle: string
}

export const monthName = (i: number) => MONTHS[i] ?? ''

/** Years in which something happened: for the switcher. Newest first; the current year is always shown. */
export function yearsWithData(ints: Interaction[], now = Date.now()): number[] {
  const ys = new Set<number>([new Date(now).getFullYear()])
  for (const i of ints) if (CONTACT.has(i.type)) ys.add(new Date(i.date).getFullYear())
  return [...ys].sort((a, b) => b - a)
}

const weekIndex = (value: number) => Math.floor((value + 3 * DAY) / (7 * DAY))

export function yearReview(year: number, people: Person[], allInts: Interaction[], now = Date.now()): YearReview {
  const start = new Date(year, 0, 1).getTime()
  const endOfYear = new Date(year + 1, 0, 1).getTime() - 1
  const end = Math.min(endOfYear, now)
  const partial = endOfYear > now
  const net = people.filter(p => !p.familyOf)
  const byId = new Map(net.map(p => [p.id, p]))
  const isIn = (value2: number) => value2 >= start && value2 <= endOfYear

  // contact with family alone is not part of the network recap: it happens every day and would distort the picture
  const counts = (i: Interaction) => CONTACT.has(i.type) && i.personIds.some(id => byId.has(id))
  const ints = allInts.filter(i => counts(i) && isIn(i.date))
  const countOf = (types: string[]) => ints.filter(i => types.includes(i.type)).length
  const total = ints.length

  const per = new Map<string, Interaction[]>()
  for (const i of ints) for (const id of i.personIds) if (byId.has(id)) per.set(id, [...(per.get(id) ?? []), i])

  const topPeople = [...per.entries()]
    .map(([id, list]) => ({ person: byId.get(id)!, count: list.length }))
    .sort((a, b) => b.count - a.count || collate(a.person.firstName, b.person.firstName))
    .slice(0, 5)

  const newPeople = net
    .filter(p => {
      const value3 = p.metAt ? new Date(`${p.metAt}T12:00:00`).getTime() : p.createdAt
      return isIn(value3)
    })
    .sort((a, b) => b.createdAt - a.createdAt)

  const cityCount = new Map<string, number>()
  for (const i of ints) {
    if (i.type !== 'meeting' && i.type !== 'event') continue
    const seen = new Set<string>()
    for (const id of i.personIds) { const c = byId.get(id)?.city?.trim(); if (c && !seen.has(c)) { seen.add(c); cityCount.set(c, (cityCount.get(c) ?? 0) + 1) } }
  }
  const cities = [...cityCount.entries()].map(([city, n]) => ({ city, count: n })).sort((a, b) => b.count - a.count).slice(0, 6)

  const warmest = [...per.entries()]
    .filter(([, list]) => new Set(list.map(i => Math.floor(i.date / DAY))).size >= 3)
    .map(([id, list]) => {
      const p = byId.get(id)!
      const pts = warmthHistory(p, allInts.filter(i => i.personIds.includes(id)), end, 60).filter(x => x.t >= start && x.t <= end && x.score !== null)
      const score = pts.length ? Math.round(pts.reduce((s, x) => s + (x.score ?? 0), 0) / pts.length) : 0
      return { person: p, score, count: list.length }
    })
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, 3)

  // lost: you used to be in touch regularly, but the last six months are silent
  const cutoff = end - 180 * DAY
  const lost: YearReview['lost'] = []
  for (const p of net) {
    if (p.archived || p.lifeStatus === 'irrelevant' || p.everyday) continue
    if (p.lifeStatus === 'lost_touch' && p.lifeStatusAt && isIn(p.lifeStatusAt)) {
      lost.push({ person: p, lastAt: p.lastContactAt ?? null, reason: 'status' })
      continue
    }
    if (p.lifeStatus || !cadenceOf(p)) continue
    const mine = allInts.filter(i => CONTACT.has(i.type) && i.personIds.includes(p.id))
    const before = new Set(mine.filter(i => i.date >= end - 540 * DAY && i.date < cutoff).map(i => Math.floor(i.date / DAY)))
    const after = mine.some(i => i.date >= cutoff && i.date <= end)
    if (before.size >= 2 && !after) lost.push({ person: p, lastAt: Math.max(...mine.filter(i => i.date < cutoff).map(i => i.date)), reason: 'silent' })
  }
  lost.sort((a, b) => Number(b.reason === 'status') - Number(a.reason === 'status') || (b.lastAt ?? 0) - (a.lastAt ?? 0))

  const monthly = Array.from({ length: 12 }, () => 0)
  for (const i of ints) monthly[new Date(i.date).getMonth()]!++
  const maxM = Math.max(...monthly)
  const busiestMonth = maxM > 0 ? { index: monthly.indexOf(maxM), name: MONTHS[monthly.indexOf(maxM)]!, count: maxM } : null

  const weeks = [...new Set(ints.map(i => weekIndex(i.date)))].sort((a, b) => a - b)
  let streak = 0
  let cur = 0
  weeks.forEach((w, k) => { cur = k > 0 && w === weeks[k - 1]! + 1 ? cur + 1 : 1; streak = Math.max(streak, cur) })

  const prev = allInts.filter(i => counts(i) && i.date >= new Date(year - 1, 0, 1).getTime() && i.date < start).length
  // compare fairly: for an unfinished year, take the same stretch of last year
  const prevSame = partial
    ? allInts.filter(i => counts(i) && i.date >= new Date(year - 1, 0, 1).getTime() && i.date <= new Date(year - 1, new Date(end).getMonth(), new Date(end).getDate(), 23, 59, 59).getTime()).length
    : prev
  const deltaPct = prevSame >= 5 ? Math.round(((total - prevSame) / prevSame) * 100) : null

  const meetings = countOf(['meeting'])
  const events = countOf(['event'])
  const calls = countOf(['call'])
  const messages = countOf(['message'])
  const uniquePeople = per.size

  const talk = calls + messages
  let title = t('A year of strong bonds')
  let subtitle = t('Steady, calm communication with all kinds of people.')
  if (total === 0) { title = t('The year ahead'); subtitle = t('Log your interactions — and your story will appear here.') }
  else if (newPeople.length >= Math.max(5, uniquePeople * 0.35)) { title = t('A year of new acquaintances'); subtitle = t("The network has grown noticeably: many people are around who weren't there a year ago.") }
  else if (meetings + events > talk) { title = t('A year of live meetings'); subtitle = t('You more often chose meeting in person over messaging.') }
  else if (talk > meetings + events) { title = t('A year of calls and chats'); subtitle = t('The connection was held together by conversations and messages.') }

  return {
    year, partial, hasData: total > 0, total, meetings, events, calls, messages,
    favors: countOf(['favor_given', 'favor_got']), uniquePeople, newPeople,
    topPeople, cities, warmest, lost: lost.slice(0, 5),
    reciprocity: reciprocity(ints, end, 366), monthly, busiestMonth, weekStreak: streak, deltaPct, title, subtitle,
  }
}
