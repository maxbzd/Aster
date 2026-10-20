import { db } from '@/data/db'
import { blankPerson } from '@/data/actions'
import { blankLead } from '@/data/leads'
import type { Interaction, Lead, Person, Reminder } from '@/data/types'
import { DAY } from '@/lib/format'

/** A fixed "now": Monday, 5 October 2026, 12:00 (local time). */
export const NOW = new Date(2026, 9, 5, 12, 0, 0).getTime()

let seq = 0
export const person = (p: Partial<Person> = {}): Person =>
  blankPerson({ id: `p${++seq}`, firstName: 'Иван', createdAt: NOW - 400 * DAY, updatedAt: NOW - 400 * DAY, ...p })

export const lead = (p: Partial<Lead> = {}): Lead =>
  blankLead({ id: `l${++seq}`, firstName: 'Контакт', createdAt: NOW - 10 * DAY, updatedAt: NOW - 10 * DAY, ...p })

export const interaction = (p: Partial<Interaction> & { personIds: string[] }): Interaction => ({
  id: `i${++seq}`, type: 'message', date: NOW - DAY, createdAt: NOW - DAY, ...p,
})

export const reminder = (p: Partial<Reminder> = {}): Reminder => ({
  id: `r${++seq}`, text: 'Позвонить', dueAt: NOW + DAY, done: false, createdAt: NOW - DAY, ...p,
})

/** A person whose last contact was `days` days ago. */
export const contactedAgo = (days: number, p: Partial<Person> = {}) => person({ lastContactAt: NOW - days * DAY, ...p })

export async function resetDb() {
  await Promise.all(db.tables.map(t => t.clear()))
}
