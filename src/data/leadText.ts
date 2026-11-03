import type { Lead } from './types'

/** All the words of a reserve contact in one line: what a search looks through. */
export const leadText = (l: Pick<Lead, 'firstName' | 'lastName' | 'company' | 'role' | 'city' | 'why' | 'source' | 'notes' | 'tags' | 'channels'>) =>
  [l.firstName, l.lastName, l.company, l.role, l.city, l.why, l.source, l.notes, ...l.tags, ...l.channels.map(c => c.value)].filter(Boolean).join(' ')
