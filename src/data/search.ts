import type { Person } from './types'
import { fullName } from '@/lib/format'
import { nameScore } from '@/lib/names'

/** Everything a person can be found by: name, work, city, notes, tags, preferences, important dates. */
export const haystack = (p: Person) =>
  [fullName(p), p.nickname, p.company, p.role, p.city, p.metPlace, p.notes, p.family, p.canHelpMe, p.iCanHelp, p.lookingFor,
    ...p.tags, ...p.facts.map(f => f.text), ...p.channels.map(c => c.value),
    ...(p.importantDates ?? []).map(d => d.label), p.prefs?.food, p.prefs?.hobbies?.join(' ')]
    .filter(Boolean).join(' ').toLowerCase()

/**
 * Every word of the query must be found either in the card's text or in the name, taking into account
 * transliteration and short forms: "Alexey" finds "Алексей", "Sasha" finds "Alexander".
 */
export function personMatches(query: string, p: Person, hay: string = haystack(p)): boolean {
  const query2 = query.trim().toLowerCase()
  if (!query2) return true
  return query2.split(/\s+/).every(w => hay.includes(w) || nameScore(w, p) > 0)
}
