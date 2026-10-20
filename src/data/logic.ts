import type { Closeness, Person } from './types'
import { DAY, daysBetween, fromISODate, startOfDay } from '@/lib/format'
import { t } from '@/i18n'

export const CLOSENESS: Record<Closeness, { name: string; short: string; plural: string; cadence: number; weight: number }> = {
  1: { get name() { return t('Inner circle') }, get short() { return t('Inner') }, get plural() { return t('inner circle') }, cadence: 14, weight: 4 },
  2: { get name() { return t('Close ones') }, get short() { return t('Close friend') }, get plural() { return t('close ones') }, cadence: 30, weight: 3 },
  3: { get name() { return t('Network') }, get short() { return t('Network') }, get plural() { return t('network') }, cadence: 90, weight: 2 },
  4: { get name() { return t('Acquaintances') }, get short() { return t('Acquaintance') }, get plural() { return t('acquaintances') }, cadence: 180, weight: 1 },
}

export const CADENCE_OPTIONS = [
  { days: 7, get label() { return t('Once a week') }, get short() { return t('week') } },
  { days: 14, get label() { return t('Every 2 weeks') }, get short() { return t('2 weeks') } },
  { days: 30, get label() { return t('Once a month') }, get short() { return t('month') } },
  { days: 90, get label() { return t('Once a quarter') }, get short() { return t('quarter') } },
  { days: 180, get label() { return t('Every six months') }, get short() { return t('6 months') } },
  { days: 365, get label() { return t('Once a year') }, get short() { return t('year') } },
  { days: 0, get label() { return t('No rhythm') }, get short() { return t('no rhythm') } },
]

/**
 * The contact rhythm. Zero means no reminders are needed: family (they have their own dates), "around every day",
 * and people with the status "lost touch", "paused" or "no longer relevant".
 */
export const cadenceOf = (p: Person) =>
  p.familyOf || p.everyday || p.lifeStatus ? 0 : p.cadenceDays === undefined ? CLOSENESS[p.closeness].cadence : p.cadenceDays
export const cadenceLabel = (days: number) =>
  CADENCE_OPTIONS.find(o => o.days === days)?.label ?? t('Every {days} days', { days })

/** Whether a person is in the "live" network: not archived, not a family member. Statuses (paused and the like) stay in the network. */
export const inNetwork = (p: Person) => !p.archived && !p.familyOf

export type WarmthLevel = 'hot' | 'warm' | 'cooling' | 'cold' | 'none'

export const WARMTH_LABEL: Record<WarmthLevel, string> = {
  get hot() { return t('Hot') },
  get warm() { return t('Warm') },
  get cooling() { return t('Cooling') },
  get cold() { return t('Cold') },
  get none() { return t('No rhythm') },
}

export interface Warmth {
  level: WarmthLevel
  score: number // 0..100
  ratio: number // daysSince / cadence
  daysSince: number
  cadence: number
  dueIn: number // days until the next contact (may be negative)
}

export const contactAnchor = (p: Person) =>
  p.lastContactAt ?? (p.metAt ? fromISODate(p.metAt) : p.createdAt)

export function warmthOf(p: Person, now = Date.now()): Warmth {
  const cadence = cadenceOf(p)
  const daysSince = Math.max(0, daysBetween(contactAnchor(p), now))
  if (!cadence) return { level: 'none', score: 100, ratio: 0, daysSince, cadence: 0, dueIn: Infinity }
  const ratio = daysSince / cadence
  const level: WarmthLevel = ratio <= 0.5 ? 'hot' : ratio <= 1 ? 'warm' : ratio <= 2 ? 'cooling' : 'cold'
  const score = Math.round(Math.max(0, Math.min(100, 100 - Math.max(0, ratio - 0.5) * 50)))
  return { level, score, ratio, daysSince, cadence, dueIn: cadence - daysSince }
}

export const isSnoozed = (p: Person, now = Date.now()) => !!p.snoozedUntil && p.snoozedUntil > now

/** The network pulse: the weighted average warmth (the inner circle weighs more). */
export function networkHealth(people: Person[], now = Date.now()) {
  let sum = 0, w = 0, inRhythm = 0, tracked = 0
  for (const p of people) {
    if (p.archived) continue
    const wm = warmthOf(p, now)
    if (wm.level === 'none') continue
    const weight = CLOSENESS[p.closeness].weight
    sum += wm.score * weight
    w += weight
    tracked++
    if (wm.ratio <= 1) inRhythm++
  }
  const score = w ? Math.round(sum / w) : 0
  return { score, inRhythm, tracked }
}

export function healthLabel(score: number) {
  if (score >= 80) return { title: t('Network in great shape'), tone: 'hot' as const }
  if (score >= 60) return { title: t('Network in good shape'), tone: 'warm' as const }
  if (score >= 40) return { title: t('Time to get in touch'), tone: 'cooling' as const }
  return { title: t('Connections are cooling'), tone: 'cold' as const }
}

/** Close ones (the two inner orbits) whose connection is cooling. A shared measure for the hub and the weekly brief. */
export function coolingClose(people: Person[], now = Date.now()) {
  return people
    .filter(p => !p.archived && p.closeness <= 2)
    .map(p => ({ p, w: warmthOf(p, now) }))
    .filter(x => x.w.level === 'cooling' || x.w.level === 'cold')
    .sort((a, b) => a.p.closeness - b.p.closeness || b.w.ratio - a.w.ratio)
}

/** Who is due for a message: past their rhythm, sorted by closeness and by how overdue they are. */
export function dueContacts(people: Person[], now = Date.now()) {
  return people
    .filter(p => !p.archived && !isSnoozed(p, now))
    .map(p => ({ p, w: warmthOf(p, now) }))
    .filter(({ w }) => w.level !== 'none' && w.ratio >= 1)
    .sort((a, b) => a.p.closeness - b.p.closeness || b.w.ratio - a.w.ratio)
}

export interface BirthdayInfo { days: number; date: number; turning?: number }

export function nextBirthday(bday: string | undefined, now = Date.now()): BirthdayInfo | null {
  if (!bday) return null
  const m = bday.match(/^(\d{4}|--)-?(\d{2})-(\d{2})$/)
  if (!m) return null
  const year = m[1] === '--' ? undefined : Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  const today = startOfDay(now)
  const y = new Date(now).getFullYear()
  // in a non-leap year, 29 February is celebrated on the 28th, not on 1 March
  const at = (yr: number) => new Date(yr, month, month === 1 && day === 29 && new Date(yr, 1, 29).getMonth() !== 1 ? 28 : day).getTime()
  let next = at(y)
  if (next < today) next = at(y + 1)
  const days = Math.round((next - today) / DAY)
  const turning = year ? new Date(next).getFullYear() - year : undefined
  return { days, date: next, turning }
}

export function upcomingBirthdays(people: Person[], within = 30, now = Date.now()) {
  return people
    .filter(p => !p.archived)
    .map(p => ({ p, b: nextBirthday(p.birthday, now) }))
    .filter((x): x is { p: Person; b: BirthdayInfo } => !!x.b && x.b.days <= within)
    .sort((a, b) => a.b.days - b.b.days)
}

/** "Person of the day": a choice, stable through the day, among those who are cooling, with close ones given priority. */
export function personOfTheDay(people: Person[], now = Date.now()) {
  const pool = people
    .filter(p => !p.archived && !isSnoozed(p, now))
    .map(p => ({ p, w: warmthOf(p, now) }))
    .filter(({ w }) => w.level === 'cooling' || w.level === 'cold')
    .filter(({ p }) => p.closeness <= 3)
    .sort((a, b) => a.p.id.localeCompare(b.p.id))
  if (!pool.length) return null
  const dayIndex = Math.floor(startOfDay(now) / DAY)
  return pool[dayIndex % pool.length]
}
