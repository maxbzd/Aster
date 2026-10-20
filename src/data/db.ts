import Dexie, { type EntityTable } from 'dexie'
import type { AiCacheEntry, AiUsage, Capture, ChatMessage, Circle, Collection, Interaction, Intro, Lead, NetEvent, Person, Reminder, Settings } from './types'

export class AsterDB extends Dexie {
  people!: EntityTable<Person, 'id'>
  interactions!: EntityTable<Interaction, 'id'>
  reminders!: EntityTable<Reminder, 'id'>
  circles!: EntityTable<Circle, 'id'>
  settings!: EntityTable<Settings, 'id'>
  intros!: EntityTable<Intro, 'id'>
  events!: EntityTable<NetEvent, 'id'>
  captures!: EntityTable<Capture, 'id'>
  aiCache!: EntityTable<AiCacheEntry, 'key'>
  aiUsage!: EntityTable<AiUsage, 'id'>
  leads!: EntityTable<Lead, 'id'>
  /** the queue of changes not yet sent to the cloud */
  outbox!: EntityTable<OutboxEntry, 'key'>
  /** sync bookkeeping (the cursor, the owner of the data) */
  syncMeta!: EntityTable<SyncMetaEntry, 'key'>
  /** bookkeeping of the bridge to the other app (cursors, caches), on this device only */
  bridgeMeta!: EntityTable<SyncMetaEntry, 'key'>
  collections!: EntityTable<Collection, 'id'>
  /** the conversation with Astra, on this device only */
  chat!: EntityTable<ChatMessage, 'id'>

  constructor(name = 'aster') {
    super(name)
    this.version(1).stores({
      people: 'id, firstName, lastName, closeness, *circleIds, *tags, lastContactAt, updatedAt',
      interactions: 'id, date, *personIds, type',
      reminders: 'id, dueAt, personId',
      circles: 'id, order',
      settings: 'id',
    })
    this.version(2).stores({
      intros: 'id, status, aId, bId',
      events: 'id, startedAt',
      captures: 'id, eventId, createdAt, status',
      aiCache: 'key, at',
      aiUsage: 'id, at',
    })
    this.version(3).stores({
      leads: 'id, createdAt, batchId, star, *tags',
    })
    this.version(4).stores({
      outbox: 'key, ts',
      syncMeta: 'key',
    })
    this.version(5).stores({
      bridgeMeta: 'key',
    })
    this.version(6).stores({
      collections: 'id, order, *personIds',
      chat: 'id, at',
    })
  }
}

export interface OutboxEntry { key: string; table: string; rowId: string; ts: number }
export interface SyncMetaEntry { key: string; value: unknown }

export const db = new AsterDB()

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
