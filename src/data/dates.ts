import type { ID, ImportantDate, Person } from './types'
import { ageOf, RELATION_LABEL } from './family'
import { nextBirthday } from './logic'
import { DAY, startOfDay } from '@/lib/format'
import { getLocale, t, tn } from '@/i18n'

export const DATE_KIND_LABEL: Record<ImportantDate['kind'], string> = {
  get anniversary() { return t('Anniversary') },
  get nameday() { return t('Name day') },
  get jubilee() { return t('Jubilee') },
  get event() { return t('Event') },
  get custom() { return t('Another date') },
}
export const DATE_KIND_EMOJI: Record<ImportantDate['kind'], string> = { anniversary: '💍', nameday: '🕯️', jubilee: '🎉', event: '📌', custom: '⭐' }

export interface Occurrence { days: number; date: number; /** how many years it will be / it has been */ years?: number }

const parse = (s: string) => {
  const m = s.match(/^(\d{4}|--)-?(\d{2})-(\d{2})$/)
  if (!m) return null
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  return { year: m[1] === '--' ? undefined : Number(m[1]), month, day }
}

/** The next occurrence of a date. A one-off date in the past gives null. */
export function nextOccurrence(date: string, yearly = true, now = Date.now()): Occurrence | null {
  const d = parse(date)
  if (!d) return null
  const today = startOfDay(now)
  if (!yearly) {
    if (d.year === undefined) return null
    const at = new Date(d.year, d.month, d.day).getTime()
    return at < today ? null : { days: Math.round((at - today) / DAY), date: at }
  }
  const b = nextBirthday(date, now)
  return b ? { days: b.days, date: b.date, years: b.turning } : null
}

export type OccurrenceKind = 'birthday' | ImportantDate['kind']

export interface UpcomingDate {
  key: string
  /** whose celebration or date this is (for a family member, the member themselves) */
  person: Person
  /** whom to write to: the owner of the family or the person themselves */
  contactId: ID
  kind: OccurrenceKind
  label: string
  days: number
  date: number
  years?: number
  /** a jubilee: a round date */
  round?: boolean
}

const isRound = (n?: number) => !!n && n >= 5 && n % 5 === 0

/**
 * All upcoming dates: birthdays (family members' included) and people's important dates.
 * Archived people and those marked "no longer relevant" are skipped: there are no reminders for them.
 */
export function upcomingDates(people: Person[], within = 30, now = Date.now()): UpcomingDate[] {
  const byId = new Map(people.map(p => [p.id, p]))
  const out: UpcomingDate[] = []
  for (const p of people) {
    if (p.archived || p.lifeStatus === 'irrelevant') continue
    const owner = p.familyOf ? byId.get(p.familyOf) : undefined
    if (p.familyOf && (!owner || owner.archived)) continue
    const who = p.familyOf && owner ? `${p.firstName}, ${t('{relation} of {name}', { relation: RELATION_LABEL[p.relation ?? 'relative'].toLowerCase(), name: genitive(owner.firstName) })}` : null
    const b = nextBirthday(p.birthday, now)
    if (b && b.days <= within) {
      out.push({ key: `b-${p.id}`, person: p, contactId: owner?.id ?? p.id, kind: 'birthday', label: who ? t('Birthday: {who}', { who }) : t('Birthday'), days: b.days, date: b.date, years: b.turning, round: isRound(b.turning) })
    }
    for (const d of p.importantDates ?? []) {
      const o = nextOccurrence(d.date, d.yearly !== false, now)
      if (!o || o.days > Math.max(within, d.remindDays ?? 0)) continue
      out.push({ key: `d-${p.id}-${d.id}`, person: p, contactId: owner?.id ?? p.id, kind: d.kind, label: who ? `${d.label}: ${who}` : d.label, days: o.days, date: o.date, years: o.years, round: isRound(o.years) })
    }
  }
  return out.sort((a, b) => a.days - b.days)
}

/** Minimal Russian genitive for captions like «дочь Алины» (typical endings). Other languages leave the name as is. */
export function genitive(name: string): string {
  const n = name.trim()
  if (getLocale() !== 'ru') return n
  if (/[ая]$/i.test(n) && !/ия$/i.test(n)) return n.replace(/а$/i, 'ы').replace(/я$/i, 'и')
  if (/ия$/i.test(n)) return n.replace(/ия$/i, 'ии')
  if (/й$/i.test(n)) return n.replace(/й$/i, 'я')
  if (/ь$/i.test(n)) return n.replace(/ь$/i, 'я')
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(n)) return `${n}а`
  return n
}

/** "Turning 5" / "10 years" for hints. */
export function yearsText(o: { kind: OccurrenceKind; years?: number }): string | null {
  if (!o.years) return null
  return o.kind === 'birthday' ? t('turns {years}', { years: o.years }) : tn(o.years, '{n} year', '{n} years')
}

export { ageOf }
