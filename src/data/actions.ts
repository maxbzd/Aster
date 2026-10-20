import { db, uid } from './db'
import type { AiSettings, Circle, ID, Interaction, InteractionType, Person, Reminder, Settings, SttSettings, VoiceSettings } from './types'
import { DAY } from '@/lib/format'
import { download } from '@/lib/ics'
import { getLocale, t } from '@/i18n'

/** Types that count as real contact (a note does not). */
export const CONTACT_TYPES: InteractionType[] = ['meeting', 'call', 'message', 'event', 'favor_given', 'favor_got', 'gift']

export function blankPerson(partial: Partial<Person> = {}): Person {
  const now = Date.now()
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    firstName: '',
    circleIds: [],
    tags: [],
    closeness: 3,
    channels: [],
    facts: [],
    topics: [],
    links: [],
    ...partial,
  }
}

export async function savePerson(p: Person) {
  p.updatedAt = Date.now()
  await db.people.put(p)
  return p.id
}

export async function patchPerson(id: ID, patch: Partial<Person>) {
  await db.people.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deletePerson(rootId: ID) {
  await db.transaction('rw', db.people, db.interactions, db.reminders, db.collections, async () => {
    // a person's family goes with them: these are their cards and do not live on their own
    const ids = [rootId, ...(await db.people.filter(x => x.familyOf === rootId).toArray()).map(x => x.id)]
    for (const id of ids) {
      await db.people.delete(id)
      for (const c of await db.collections.filter(x => x.personIds.includes(id)).toArray()) await db.collections.update(c.id, { personIds: c.personIds.filter(x => x !== id), updatedAt: Date.now() })
      await db.reminders.where('personId').equals(id).delete()
      const ints = await db.interactions.where('personIds').equals(id).toArray()
      for (const it of ints) {
        const rest = it.personIds.filter(x => x !== id)
        if (rest.length) await db.interactions.update(it.id, { personIds: rest })
        else await db.interactions.delete(it.id)
      }
      // remove the links from other people's cards
      const linked = await db.people.filter(p => p.links.some(l => l.personId === id) || p.introducedBy === id).toArray()
      for (const p of linked) {
        await db.people.update(p.id, {
          links: p.links.filter(l => l.personId !== id),
          introducedBy: p.introducedBy === id ? undefined : p.introducedBy,
        })
      }
    }
  })
}

export async function recomputeLastContact(personId: ID) {
  const ints = await db.interactions.where('personIds').equals(personId).toArray()
  const last = ints.filter(i => CONTACT_TYPES.includes(i.type)).reduce((m, i) => Math.max(m, i.date), 0)
  await db.people.update(personId, { lastContactAt: last || undefined })
}

export async function logInteraction(data: Omit<Interaction, 'id' | 'createdAt'>) {
  const it: Interaction = { ...data, id: uid(), createdAt: Date.now() }
  await db.interactions.put(it)
  for (const pid of it.personIds) {
    await recomputeLastContact(pid)
    if (CONTACT_TYPES.includes(it.type)) await db.people.update(pid, { snoozedUntil: undefined })
  }
  return it.id
}

/** Editing an interaction: date, participants, type, title, note, place, who started. The last contact is recalculated for everyone it concerns. */
export async function updateInteraction(id: ID, patch: Partial<Omit<Interaction, 'id' | 'createdAt'>>) {
  const before = await db.interactions.get(id)
  if (!before) return
  const personIds = patch.personIds ? [...new Set(patch.personIds)] : before.personIds
  if (!personIds.length) throw new RangeError(t('An entry needs at least one participant'))
  await db.interactions.put({ ...before, ...patch, personIds })
  const touched = new Set([...before.personIds, ...personIds])
  for (const pid of touched) {
    await recomputeLastContact(pid)
    if (!before.personIds.includes(pid) && CONTACT_TYPES.includes((patch.type ?? before.type))) await db.people.update(pid, { snoozedUntil: undefined })
  }
}

export async function deleteInteraction(id: ID) {
  const it = await db.interactions.get(id)
  if (!it) return
  await db.interactions.delete(id)
  for (const pid of it.personIds) await recomputeLastContact(pid)
}

export async function addReminder(r: Omit<Reminder, 'id' | 'createdAt' | 'done'>) {
  const rem: Reminder = { ...r, id: uid(), createdAt: Date.now(), done: false }
  await db.reminders.put(rem)
  return rem.id
}

export async function toggleReminder(id: ID) {
  const r = await db.reminders.get(id)
  if (!r) return
  await db.reminders.update(id, { done: !r.done, doneAt: !r.done ? Date.now() : undefined, updatedAt: Date.now() })
}

/** Deletes a reminder. If it is the mirror of a commitment from Orbita, the bridge will not recreate it. */
export async function deleteReminder(id: ID) {
  const r = await db.reminders.get(id)
  await db.transaction('rw', db.reminders, db.settings, async () => {
    await db.reminders.delete(id)
    if (r?.bridgeKey) {
      const s = await db.settings.get('me')
      if (s) await db.settings.put({ ...s, bridgeHandled: [...new Set([...(s.bridgeHandled ?? []), `rem:${r.bridgeKey}`])].slice(-1000) })
    }
  })
}

export async function snooze(personId: ID, days = 7) {
  await patchPerson(personId, { snoozedUntil: Date.now() + days * DAY })
}

export async function getSettings(): Promise<Settings | undefined> {
  return db.settings.get('me')
}

export async function saveSettings(patch: Partial<Settings>) {
  const cur = (await db.settings.get('me')) ?? { id: 'me' as const, name: '', onboarded: false, createdAt: Date.now() }
  await db.settings.put({ ...cur, ...patch })
}

/**
 * Change Astra's settings atomically: fresh values are read inside the transaction.
 * So quick consecutive edits (entering a key, then consent) do not overwrite each other with a stale copy from the screen.
 */
export async function patchAi(patch: Partial<AiSettings>, defaults: AiSettings) {
  await db.transaction('rw', db.settings, async () => {
    const cur = (await db.settings.get('me')) ?? { id: 'me' as const, name: '', onboarded: false, createdAt: Date.now() }
    await db.settings.put({ ...cur, ai: { ...defaults, ...cur.ai, ...patch } })
  })
}

export const DEFAULT_CIRCLES: Omit<Circle, 'id' | 'order'>[] = [
  { get name() { return t('Work') }, emoji: '💼', palette: 'ocean' },
  { get name() { return t('Friends') }, emoji: '✨', palette: 'ember' },
  { get name() { return t('Family') }, emoji: '🏡', palette: 'rose' },
  { get name() { return t('Investors') }, emoji: '📈', palette: 'jade' },
  { get name() { return t('Mentors') }, emoji: '🧭', palette: 'orchid' },
  { get name() { return t('Clients') }, emoji: '🤝', palette: 'gold' },
  { get name() { return t('Community') }, emoji: '🌐', palette: 'aurora' },
  { get name() { return t('Sports') }, emoji: '🏃', palette: 'ice' },
]

export async function setCircles(list: Omit<Circle, 'id' | 'order'>[]) {
  await db.circles.clear()
  await db.circles.bulkPut(list.map((c, i) => ({ ...c, id: uid(), order: i })))
}

export async function wipeAll() {
  await db.transaction('rw', [db.people, db.interactions, db.reminders, db.circles, db.settings, db.intros, db.events, db.captures, db.aiCache, db.leads, db.collections, db.chat], async () => {
    await Promise.all([db.people.clear(), db.interactions.clear(), db.reminders.clear(), db.circles.clear(), db.settings.clear(), db.intros.clear(), db.events.clear(), db.captures.clear(), db.aiCache.clear(), db.leads.clear(), db.collections.clear(), db.chat.clear()])
  })
}

/** Clears people's data without losing the settings (the name, Astra's connection). */
export async function wipeNetwork() {
  await db.transaction('rw', [db.people, db.interactions, db.reminders, db.circles, db.intros, db.events, db.captures, db.aiCache, db.leads, db.collections, db.chat], async () => {
    await Promise.all([db.people.clear(), db.interactions.clear(), db.reminders.clear(), db.circles.clear(), db.intros.clear(), db.events.clear(), db.captures.clear(), db.aiCache.clear(), db.leads.clear(), db.collections.clear(), db.chat.clear()])
  })
}

/* ---------- Backup ---------- */
export async function exportBackup() {
  const [people, interactions, reminders, circles, settings, intros, events, leads, collections] = await Promise.all([
    db.people.toArray(), db.interactions.toArray(), db.reminders.toArray(), db.circles.toArray(), db.settings.toArray(), db.intros.toArray(), db.events.toArray(), db.leads.toArray(), db.collections.toArray(),
  ])
  // keys (Astra, speech recognition) do not go into the backup
  const safeSettings = settings.map(s => {
    const { stt: _stt, ...rest } = s
    return rest.ai ? { ...rest, ai: { ...rest.ai, apiKey: undefined, proxyToken: undefined } } : rest
  })
  return { app: 'aster', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), people, interactions, reminders, circles, settings: safeSettings, intros, events, leads, collections }
}

/** Download a backup as a file and remember the date: the app uses it to remind about backups. */
export async function backupToFile() {
  const data = await exportBackup()
  download(`aster-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json')
  await saveSettings({ lastBackupAt: Date.now() })
}

export const BACKUP_VERSION = 4

export class BackupError extends Error {}

const TABLES = ['people', 'interactions', 'reminders', 'circles', 'settings', 'intros', 'events', 'leads', 'collections'] as const
type BackupTable = (typeof TABLES)[number]

/** The file is validated BEFORE anything in the database is touched: a broken backup must not erase live data. */
export function validateBackup(data: unknown): asserts data is { app: 'aster'; version?: number } & Partial<Record<BackupTable, Record<string, unknown>[]>> {
  const d = data as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || d.app !== 'aster') throw new BackupError(t('This is not an Aster backup'))
  if (typeof d.version === 'number' && d.version > BACKUP_VERSION) throw new BackupError(t('The backup was made in a newer version of Aster — update the app'))
  for (const item of TABLES) {
    const rows = d[item]
    if (rows === undefined) continue
    if (!Array.isArray(rows)) throw new BackupError(t('Backup is corrupted: “{item}” must be a list', { item }))
    rows.forEach((r, i) => {
      if (!r || typeof r !== 'object' || typeof (r as { id?: unknown }).id !== 'string') throw new BackupError(t('Backup is corrupted: “{item}”, record {v} has no id', { item, v: i + 1 }))
    })
  }
  const bad = (d.people as { firstName?: unknown }[] | undefined)?.findIndex(p => typeof p.firstName !== 'string')
  if (bad !== undefined && bad >= 0) throw new BackupError(t('Backup is corrupted: person {v} has no name', { v: bad + 1 }))
  const badLead = (d.leads as { firstName?: unknown }[] | undefined)?.findIndex(p => typeof p.firstName !== 'string')
  if (badLead !== undefined && badLead >= 0) throw new BackupError(t('Backup is corrupted: reserve contact {v} has no name', { v: badLead + 1 }))
  const badInt = (d.interactions as { personIds?: unknown }[] | undefined)?.findIndex(i => !Array.isArray(i.personIds))
  if (badInt !== undefined && badInt >= 0) throw new BackupError(t('Backup is corrupted: interaction {v} has no participants', { v: badInt + 1 }))
}

export interface ImportOptions {
  /** replace: replace everything; merge: add from the backup without deleting what exists (on an id clash the backup wins) */
  mode?: 'replace' | 'merge'
}

/** Returns how many records were loaded. */
export async function importBackup(data: unknown, { mode = 'replace' }: ImportOptions = {}) {
  validateBackup(data)
  const current = await db.settings.get('me')
  let loaded = 0
  await db.transaction('rw', [db.people, db.interactions, db.reminders, db.circles, db.settings, db.intros, db.events, db.leads, db.collections], async () => {
    if (mode === 'replace') {
      // tables that are not in the backup (an old version without the reserve) are left alone, otherwise we would lose what the backup did not know about
      for (const item2 of TABLES) if (data[item2] !== undefined || item2 === 'settings') await db.table(item2).clear()
    }
    for (const item3 of TABLES) {
      if (item3 === 'settings') continue
      const rows = data[item3] ?? []
      await db.table(item3).bulkPut(rows)
      loaded += rows.length
    }
    // Astra's connection and the backup date belong to this device: they are not taken from the file
    if (mode === 'replace') {
      const fromFile = ((data.settings as unknown as Settings[] | undefined) ?? [])[0]
      const merged: Settings = { ...(fromFile ?? { id: 'me', name: current?.name ?? '', createdAt: current?.createdAt ?? Date.now() }), id: 'me', onboarded: true }
      if (current?.ai) merged.ai = current.ai
      else delete merged.ai
      await db.settings.put(merged)
    }
  })
  return loaded
}

async function patchSettingsKey<K extends 'stt' | 'voice'>(key: K, patch: Partial<NonNullable<Settings[K]>>, defaults: NonNullable<Settings[K]>) {
  await db.transaction('rw', db.settings, async () => {
    const cur = (await db.settings.get('me')) ?? { id: 'me' as const, name: '', onboarded: false, createdAt: Date.now() }
    await db.settings.put({ ...cur, [key]: { ...defaults, ...cur[key], ...patch } })
  })
}

export const patchStt = (patch: Partial<SttSettings>) => patchSettingsKey('stt', patch, { provider: 'off', language: getLocale() })
export const patchVoice = (patch: Partial<VoiceSettings>) => patchSettingsKey('voice', patch, { wake: false, speak: false })
