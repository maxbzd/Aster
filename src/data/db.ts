import Dexie, { type DBCore, type DexieOptions, type EntityTable } from 'dexie'
import { reportWriteFailure, resolveFull, useStorageHealth } from '@/lib/storageHealth'
import { backendFactory, backendKeyRange, initBackend } from '@/vault/backend'
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

  constructor(name = 'aster', options?: DexieOptions) {
    super(name, options)
    // Every write passes here: a refusal for lack of room is announced to the person (see StorageBanner), and still thrown,
    // so the caller knows the change was not saved. A failed write changes nothing (the transaction is rolled back).
    this.use({
      stack: 'dbcore',
      name: 'storage-guard',
      create: (down: DBCore): DBCore => ({
        ...down,
        table: (tableName: string) => {
          const table = down.table(tableName)
          return {
            ...table,
            mutate: async req => {
              try {
                const result = await table.mutate(req)
                // writes work again (room was made, or the browser allowed more): the notice has done its job
                if (useStorageHealth.getState().full) resolveFull()
                return result
              } catch (error) {
                reportWriteFailure(error)
                throw error
              }
            },
          }
        },
      }),
    })
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

export interface OutboxEntry {
  key: string
  table: string
  rowId: string
  ts: number
  /**
   * The row as the cloud last knew it, before this device's first unsent edit: the common ancestor for the field-level
   * merge when another device changed the same row. Absent for a row created here and never sent (nothing to compare with).
   */
  base?: Record<string, unknown>
  /** The cloud's `client_ts` of that version: sent as `base_ts` so the cloud can tell that another device wrote in between. */
  baseTs?: number
}
export interface SyncMetaEntry { key: string; value: unknown }

// The storage underneath is chosen when the database is first opened: the browser's own, or (with encryption on) a memory copy.
initBackend('aster.vault')
export const db = new AsterDB('aster', { indexedDB: backendFactory, IDBKeyRange: backendKeyRange })

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
