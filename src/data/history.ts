import type { Initiator, Interaction, Person } from './types'
import { CADENCE_OPTIONS, cadenceOf, CLOSENESS } from './logic'
import { DAY } from '@/lib/format'
import { t } from '@/i18n'

/** A real contact (a note is not). The same set as in actions, but without a dependency on the database. */
const CONTACT = new Set(['meeting', 'call', 'message', 'event', 'favor_given', 'favor_got', 'gift'])

const WEIGHT: Record<string, number> = { meeting: 3, event: 2.5, call: 2, favor_given: 2, favor_got: 2, gift: 2, message: 1, note: 0 }

/* ---------- warmth history ---------- */

export interface WarmthPoint {
  /** the start of the month */
  t: number
  /** 0..100, null: the person was not known yet */
  score: number | null
  /** how many contacts there were this month */
  count: number
  /** the "weight" of the month's contact: a meeting weighs more than a message */
  activity: number
}

const monthStart = (value: number) => { const d = new Date(value); return new Date(d.getFullYear(), d.getMonth(), 1).getTime() }
const nextMonth = (value2: number) => { const d = new Date(value2); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() }

export const scoreFromRatio = (ratio: number) => Math.round(Math.max(0, Math.min(100, 100 - Math.max(0, ratio - 0.5) * 50)))

/** The rhythm for the chart: even for "no rhythm", past warmth is computed from the orbit's rhythm. */
const historyCadence = (p: Person) => cadenceOf(p) || CLOSENESS[p.closeness].cadence

/**
 * How the connection changed: the warmth at the end of each month, from how many days had passed since the last contact
 * relative to the rhythm. So you see not just "now" but whole periods when the connection was cooling.
 */
export function warmthHistory(p: Person, ints: Interaction[], now = Date.now(), maxMonths = 60): WarmthPoint[] {
  const mine = ints.filter(i => i.personIds.includes(p.id)).sort((a, b) => a.date - b.date)
  const contacts = mine.filter(i => CONTACT.has(i.type))
  // the chart starts from the day contact began to be recorded: the app does not know what was before
  const knownSince = Math.min(mine[0]?.date ?? Infinity, p.createdAt)
  const start = monthStart(knownSince)
  const cadence = historyCadence(p)
  const out: WarmthPoint[] = []
  for (let value3 = monthStart(start); value3 <= now; value3 = nextMonth(value3)) {
    const end = Math.min(nextMonth(value3) - 1, now)
    const inMonth = mine.filter(i => i.date >= value3 && i.date < nextMonth(value3))
    const last = [...contacts].reverse().find(i => i.date <= end)?.date
    const known = knownSince <= end
    const anchor = last ?? knownSince
    out.push({
      t: value3,
      score: known ? scoreFromRatio(Math.max(0, (end - anchor) / DAY) / cadence) : null,
      count: inMonth.filter(i => CONTACT.has(i.type)).length,
      activity: inMonth.reduce((s, i) => s + (WEIGHT[i.type] ?? 0), 0),
    })
  }
  return out.slice(-maxMonths)
}

export interface YearSummary { year: number; contacts: number; avgScore: number | null; best?: WarmthPoint; worst?: WarmthPoint }

export function yearSummaries(points: WarmthPoint[]): YearSummary[] {
  const years = new Map<number, WarmthPoint[]>()
  for (const p of points) years.set(new Date(p.t).getFullYear(), [...(years.get(new Date(p.t).getFullYear()) ?? []), p])
  return [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, ps]) => {
    const scored = ps.filter(x => x.score !== null)
    return {
      year,
      contacts: ps.reduce((s, x) => s + x.count, 0),
      avgScore: scored.length ? Math.round(scored.reduce((s, x) => s + (x.score as number), 0) / scored.length) : null,
      best: scored.length ? scored.reduce((a, b) => ((b.score as number) > (a.score as number) ? b : a)) : undefined,
      worst: scored.length ? scored.reduce((a, b) => ((b.score as number) < (a.score as number) ? b : a)) : undefined,
    }
  })
}

/** Where the connection is heading: the last three months against the three before. */
export function warmthTrend(points: WarmthPoint[]): 'up' | 'down' | 'flat' | null {
  const scored = points.filter(p => p.score !== null)
  if (scored.length < 6) return null
  const avg = (xs: WarmthPoint[]) => xs.reduce((s, x) => s + (x.score as number), 0) / xs.length
  const diff = avg(scored.slice(-3)) - avg(scored.slice(-6, -3))
  return diff > 8 ? 'up' : diff < -8 ? 'down' : 'flat'
}

/* ---------- reciprocity ---------- */

export interface Reciprocity {
  me: number
  them: number
  both: number
  /** records with no mark of who started */
  unknown: number
  /** −1 (only they write) … +1 (only you write) */
  skew: number
  label: string
  level: 'balanced' | 'me' | 'them' | 'unknown'
}

export function reciprocity(ints: Interaction[], now = Date.now(), windowDays = 540): Reciprocity {
  let me = 0, them = 0, both = 0, unknown = 0
  for (const i of ints) {
    if (!CONTACT.has(i.type) || now - i.date > windowDays * DAY) continue
    const who: Initiator | undefined = i.initiator
    if (who === 'me') me++
    else if (who === 'them') them++
    else if (who === 'both') both++
    else unknown++
  }
  const known = me + them
  const skew = known ? (me - them) / known : 0
  if (known < 3) return { me, them, both, unknown, skew, label: t('Too few marks of who starts the conversation'), level: 'unknown' }
  const pct = Math.round((Math.max(me, them) / known) * 100)
  if (Math.abs(skew) < 0.3) return { me, them, both, unknown, skew, label: t('Initiative is even'), level: 'balanced' }
  return skew > 0
    ? { me, them, both, unknown, skew, label: t('More often you start — {pct}%', { pct }), level: 'me' }
    : { me, them, both, unknown, skew, label: t('More often they start — {pct}%', { pct }), level: 'them' }
}

/** Who has the most noticeable imbalance in initiative (at least 4 marked contacts are needed). */
export function reciprocityRanking(people: Person[], ints: Interaction[], now = Date.now()) {
  const by = new Map<string, Interaction[]>()
  for (const i of ints) for (const pid of i.personIds) by.set(pid, [...(by.get(pid) ?? []), i])
  return people
    .filter(p => !p.archived && !p.familyOf && p.lifeStatus !== 'irrelevant')
    .map(p => ({ p, r: reciprocity(by.get(p.id) ?? [], now) }))
    .filter(x => x.r.level === 'me' || x.r.level === 'them')
    .filter(x => x.r.me + x.r.them >= 4)
    .sort((a, b) => Math.abs(b.r.skew) - Math.abs(a.r.skew))
}

/* ---------- smart rhythms ---------- */

export interface CadenceSuggestion {
  current: number
  /** how often you are really in touch, days */
  actualDays: number
  suggested: number
  direction: 'longer' | 'shorter'
  message: string
  basedOn: number
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** The nearest of the standard rhythms (by logarithm: 20 days is equally close to 14 and 30). */
export function nearestCadence(days: number): number {
  const opts = CADENCE_OPTIONS.map(o => o.days).filter(d => d > 0)
  return opts.reduce((best, d) => (Math.abs(Math.log(d / days)) < Math.abs(Math.log(best / days)) ? d : best), opts[0]!)
}

const cadenceWord = (d: number) => CADENCE_OPTIONS.find(o => o.days === d)?.label.toLowerCase() ?? t('every {d} days', { d })

/**
 * Suggests changing the rhythm if real contact differs a lot from the set one.
 * At least 4 contacts in 18 months are needed; family, "around every day" and people with a life status are skipped.
 */
export function suggestCadence(p: Person, ints: Interaction[], now = Date.now()): CadenceSuggestion | null {
  if (p.archived || p.familyOf || p.everyday || p.lifeStatus) return null
  if (p.cadenceHintDismissedAt && now - p.cadenceHintDismissedAt < 120 * DAY) return null
  const current = cadenceOf(p)
  if (!current) return null
  const dates = ints.filter(i => i.personIds.includes(p.id) && CONTACT.has(i.type) && now - i.date <= 540 * DAY).map(i => i.date).sort((a, b) => a - b)
  // several records on one day count as one contact
  const days = [...new Set(dates.map(d => Math.floor(d / DAY)))]
  if (days.length < 4) return null
  const gaps = days.slice(1).map((d, i) => d - days[i]!)
  const actual = Math.max(1, Math.round(median(gaps)))
  const suggested = nearestCadence(actual)
  if (suggested === current) return null
  // threshold: the rhythm and reality differ at least 1.8 times, otherwise it is noise
  const ratio = actual / current
  if (ratio < 1.8 && ratio > 1 / 1.8) return null
  const longer = suggested > current
  return {
    current, actualDays: actual, suggested, direction: longer ? 'longer' : 'shorter', basedOn: days.length,
    message: longer
      ? t('You talk about every {actual} days, but the rhythm is {cadenceWord}. Reminders will be redundant — maybe {cadenceWord2}?', { actual, cadenceWord: cadenceWord(current), cadenceWord2: cadenceWord(suggested) })
      : t('You talk about every {actual} days — more often than the rhythm ({cadenceWord}). You could set {cadenceWord2}.', { actual, cadenceWord: cadenceWord(current), cadenceWord2: cadenceWord(suggested) }),
  }
}

export function cadenceSuggestions(people: Person[], ints: Interaction[], now = Date.now()) {
  const by = new Map<string, Interaction[]>()
  for (const i of ints) for (const pid of i.personIds) by.set(pid, [...(by.get(pid) ?? []), i])
  return people
    .map(p => ({ p, s: suggestCadence(p, by.get(p.id) ?? [], now) }))
    .filter((x): x is { p: Person; s: CadenceSuggestion } => !!x.s)
    .sort((a, b) => Math.abs(Math.log(b.s.suggested / b.s.current)) - Math.abs(Math.log(a.s.suggested / a.s.current)))
}
