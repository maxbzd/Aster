import type { Person } from './types'
import { fullName } from '@/lib/format'
import { nameScore } from '@/lib/names'

/** Всё, по чему можно найти человека: имя, работа, город, заметки, теги, предпочтения, важные даты. */
export const haystack = (p: Person) =>
  [fullName(p), p.nickname, p.company, p.role, p.city, p.metPlace, p.notes, p.family, p.canHelpMe, p.iCanHelp, p.lookingFor,
    ...p.tags, ...p.facts.map(f => f.text), ...p.channels.map(c => c.value),
    ...(p.importantDates ?? []).map(d => d.label), p.prefs?.food, p.prefs?.hobbies?.join(' ')]
    .filter(Boolean).join(' ').toLowerCase()

/**
 * Каждое слово запроса должно найтись либо в тексте карточки, либо в имени с учётом
 * транслита и уменьшительных: «Alexey» находит «Алексея», «Саша» — «Александра».
 */
export function personMatches(query: string, p: Person, hay: string = haystack(p)): boolean {
  const query2 = query.trim().toLowerCase()
  if (!query2) return true
  return query2.split(/\s+/).every(w => hay.includes(w) || nameScore(w, p) > 0)
}
