import { db, uid } from './db'
import type { Collection, ID, Lead, PaletteKey, Person } from './types'
import { fullName } from '@/lib/format'
import { t } from '@/i18n'

export const COLLECTION_PRESETS: Array<{ name: string; emoji: string; palette: PaletteKey; note: string }> = [
  { get name() { return t('For the round') }, emoji: '📈', palette: 'jade', get note() { return t('Who to invite as investors and who to go to for intros') } },
  { get name() { return t('For hiring') }, emoji: '🧲', palette: 'ocean', get note() { return t('Candidates and those who can recommend') } },
  { get name() { return t('For PR') }, emoji: '📣', palette: 'ember', get note() { return t('Journalists, bloggers, editors') } },
  { get name() { return t('For dinner') }, emoji: '🍷', palette: 'rose', get note() { return t("Whom you'd like to gather around a table") } },
]

export const COLLECTION_EMOJI = ['📈', '🧲', '📣', '🍷', '🚀', '🎯', '🤝', '💡', '🌍', '🎓', '🏆', '🎁', '☕', '📚', '🧭', '✈️']
export const COLLECTION_PALETTES: PaletteKey[] = ['aurora', 'ember', 'rose', 'jade', 'ocean', 'gold', 'orchid', 'ice']

export interface NewCollection { name: string; emoji?: string; palette?: PaletteKey; note?: string; personIds?: ID[]; leadIds?: ID[] }

export async function createCollection(input: NewCollection): Promise<ID> {
  const name = input.name.trim()
  if (!name) throw new RangeError(t('A list needs a name'))
  const last = (await db.collections.orderBy('order').last())?.order ?? -1
  const now = Date.now()
  const c: Collection = {
    id: uid(), name: name.slice(0, 60), emoji: input.emoji ?? '⭐', palette: input.palette ?? COLLECTION_PALETTES[(last + 1) % COLLECTION_PALETTES.length]!,
    note: input.note?.trim() || undefined, personIds: [...new Set(input.personIds ?? [])], leadIds: [...new Set(input.leadIds ?? [])],
    order: last + 1, createdAt: now, updatedAt: now,
  }
  await db.collections.put(c)
  return c.id
}

export async function updateCollection(id: ID, patch: Partial<Pick<Collection, 'name' | 'emoji' | 'palette' | 'note'>>) {
  const next = { ...patch }
  if (next.name !== undefined) {
    next.name = next.name.trim().slice(0, 60)
    if (!next.name) throw new RangeError(t('A list needs a name'))
  }
  await db.collections.update(id, { ...next, updatedAt: Date.now() })
}

export const deleteCollection = (id: ID) => db.collections.delete(id)

export async function addToCollection(id: ID, add: { personIds?: ID[]; leadIds?: ID[] }) {
  await db.transaction('rw', db.collections, async () => {
    const c = await db.collections.get(id)
    if (!c) return
    await db.collections.put({ ...c, personIds: [...new Set([...c.personIds, ...(add.personIds ?? [])])], leadIds: [...new Set([...c.leadIds, ...(add.leadIds ?? [])])], updatedAt: Date.now() })
  })
}

export async function removeFromCollection(id: ID, rm: { personIds?: ID[]; leadIds?: ID[] }) {
  await db.transaction('rw', db.collections, async () => {
    const c = await db.collections.get(id)
    if (!c) return
    const p = new Set(rm.personIds ?? [])
    const l = new Set(rm.leadIds ?? [])
    await db.collections.put({ ...c, personIds: c.personIds.filter(x => !p.has(x)), leadIds: c.leadIds.filter(x => !l.has(x)), updatedAt: Date.now() })
  })
}

/** A person is added to or removed from several lists in one action (from the card or in a bulk edit). */
export async function setPersonCollections(personId: ID, collectionIds: ID[]) {
  await db.transaction('rw', db.collections, async () => {
    const want = new Set(collectionIds)
    for (const c of await db.collections.toArray()) {
      const has = c.personIds.includes(personId)
      if (want.has(c.id) && !has) await db.collections.put({ ...c, personIds: [...c.personIds, personId], updatedAt: Date.now() })
      if (!want.has(c.id) && has) await db.collections.put({ ...c, personIds: c.personIds.filter(x => x !== personId), updatedAt: Date.now() })
    }
  })
}

export const collectionsOf = (cs: Collection[], personId: ID) => cs.filter(c => c.personIds.includes(personId))

/** The members of a list in the order they were added; deleted people are skipped. */
export function membersOf(c: Collection, people: Person[], leads: Lead[] = []) {
  const byId = new Map(people.map(p => [p.id, p]))
  const byLead = new Map(leads.map(l => [l.id, l]))
  return {
    people: c.personIds.map(id => byId.get(id)).filter((p): p is Person => !!p),
    leads: c.leadIds.map(id => byLead.get(id)).filter((l): l is Lead => !!l),
  }
}

/** A list as a table for Excel and Google Sheets. */
export function collectionToCSV(c: Collection, people: Person[], leads: Lead[] = []): string {
  const q = (v: string | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`
  const m = membersOf(c, people, leads)
  const rows: string[][] = [[t('First name'), t('Role'), t('Company'), t('City'), t('Contact'), t('Source')]]
  for (const p of m.people) rows.push([fullName(p), p.role ?? '', p.company ?? '', p.city ?? '', p.channels[0]?.value ?? '', t('network')])
  for (const l of m.leads) rows.push([fullName(l), l.role ?? '', l.company ?? '', l.city ?? '', l.channels[0]?.value ?? '', t('reserve')])
  return `﻿${rows.map(r => r.map(x => q(x)).join(',')).join('\r\n')}`
}

/** Removes deleted people from all lists. Called when a person is deleted. */
export async function purgePerson(personId: ID) {
  for (const c of await db.collections.filter(x => x.personIds.includes(personId)).toArray()) {
    await db.collections.update(c.id, { personIds: c.personIds.filter(x => x !== personId), updatedAt: Date.now() })
  }
}
