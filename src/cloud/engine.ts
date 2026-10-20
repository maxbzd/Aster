import Dexie, { type Table, type Transaction } from 'dexie'
import { db as appDb, type AsterDB } from '@/data/db'
import type { Settings } from '@/data/types'

/**
 * The local-first sync engine: the app always works with Dexie,
 * and the cloud is a copy that catches up in the background.
 *
 *   a change in Dexie → a hook puts the key in the outbox → push sends whole rows
 *   the cloud → pull by the seq cursor → applied to Dexie (without sending it back)
 *
 * Conflicts are resolved by "the newest edit wins" (client_ts), the same as on the server (sync_push).
 */

export const SYNC_TABLES = ['people', 'interactions', 'reminders', 'circles', 'settings', 'intros', 'events', 'captures', 'leads', 'collections'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

export interface PushRow { tbl: SyncTable; id: string; data: Record<string, unknown> | null; deleted: boolean; client_ts: number }
export interface RemoteRecord extends PushRow { seq: number }
export interface Remote {
  push(rows: PushRow[]): Promise<{ applied: number; stale: number }>
  pull(afterSeq: number, limit: number): Promise<RemoteRecord[]>
}

/** Settings fields that live only on this device (API keys, the date of the last backup file). */
export const DEVICE_ONLY_SETTINGS = ['ai', 'stt', 'voice', 'lastBackupAt', 'backupSnoozeUntil'] as const
const isDeviceOnly = (path: string) => DEVICE_ONLY_SETTINGS.some(k => path === k || path.startsWith(`${k}.`))

/** The server rejected a record for good (bad format, too large): retrying will not help, and it is not a network failure. */
export class PermanentRemoteError extends Error {}

export interface RejectedEntry { key: string; error: string; at: number }

export const PUSH_BATCH = 100
export const PULL_PAGE = 500
/**
 * The cursor steps back by this many numbers: transactions from other devices may have been committed
 * later than ones already seen. Applying is idempotent, so reading twice is harmless.
 * Must be greater than PUSH_BATCH.
 */
export const PULL_OVERLAP = 250

type TrackedTx = Transaction & { _asterRemote?: boolean; _asterDirty?: Map<string, { table: SyncTable; id: string }> }

let lastTs = 0
/** Monotonic timestamps: two edits on one device never get the same ts. */
export const nextTs = () => (lastTs = Math.max(Date.now(), lastTs + 1))

/** Keys in alphabetical order: Postgres jsonb reorders them, and it is the content that must be compared. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** A row in the form in which it goes to the cloud (without the fields that belong to the device only). */
export function serialize(name: SyncTable, row: object): Record<string, unknown> {
  const plain = JSON.parse(JSON.stringify(row)) as Record<string, unknown>
  if (name === 'settings') for (const k of DEVICE_ONLY_SETTINGS) delete plain[k]
  return plain
}

function mergeIncoming(name: SyncTable, local: object | undefined, incoming: Record<string, unknown>): Record<string, unknown> {
  if (name !== 'settings') return incoming
  const mine = local as Record<string, unknown> | undefined
  const keep = Object.fromEntries(DEVICE_ONLY_SETTINGS.filter(k => (mine as Partial<Settings> | undefined)?.[k] !== undefined).map(k => [k, mine?.[k]]))
  return { ...incoming, ...keep }
}

/** An engine bound to one database. The app has one; tests may have several "devices". */
export function createEngine(db: AsterDB) {
  const table = (name: SyncTable) => db.table(name) as Table<{ id: string }, string>
  const listeners = new Set<() => void>()
  let installed = false

  /* ---------- tracking changes ---------- */

  const onLocalChange = (fn: () => void) => {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }

  function mark(trans: TrackedTx | undefined, name: SyncTable, id: string | undefined) {
    if (!trans || trans._asterRemote || !id) return
    let dirty = trans._asterDirty
    if (!dirty) {
      const batch = new Map<string, { table: SyncTable; id: string }>()
      dirty = trans._asterDirty = batch
      // the outbox is written after the main transaction commits: it may not include this table
      trans.on('complete', () => {
        const ts = nextTs()
        db.outbox
          .bulkPut([...batch.values()].map(d => ({ key: `${d.table}:${d.id}`, table: d.table, rowId: d.id, ts })))
          .then(() => { for (const fn of listeners) fn() })
          .catch(() => undefined)
      })
    }
    dirty.set(`${name}:${id}`, { table: name, id })
  }

  /** Subscribes to create, update and delete in the synced tables. Safe to call again. */
  function installTracking() {
    if (installed) return
    installed = true
    for (const name of SYNC_TABLES) {
      const value2 = db.table(name)
      value2.hook('creating', (_pk, obj, trans) => { mark(trans as TrackedTx, name, (obj as { id?: string }).id) })
      value2.hook('updating', (mods, pk, _obj, trans) => {
        // an edit of local-only fields (for example the API key) does not go to the cloud
        if (name === 'settings' && Object.keys(mods).every(isDeviceOnly)) return
        mark(trans as TrackedTx, name, String(pk))
      })
      value2.hook('deleting', (pk, _obj, trans) => { mark(trans as TrackedTx, name, String(pk)) })
    }
  }

  /* ---------- bookkeeping ---------- */

  const getMeta = async <T>(key: string): Promise<T | undefined> => (await db.syncMeta.get(key))?.value as T | undefined
  const setMeta = (key: string, value: unknown) => db.syncMeta.put({ key, value })
  const delMeta = (key: string) => db.syncMeta.delete(key)
  const pendingCount = () => db.outbox.count()

  /* ---------- sending ---------- */

  const rejectedList = async () => (await getMeta<RejectedEntry[]>('rejected')) ?? []
  const rejectedCount = async () => (await rejectedList()).length
  const clearRejected = () => delMeta('rejected')

  /** Rows are built from the current state of the database: what is sent is what exists now, not what it was at the time of the edit. */
  async function buildPayload(entries: Array<{ key: string; table: string; rowId: string; ts: number }>): Promise<PushRow[]> {
    const byTable = new Map<SyncTable, string[]>()
    for (const e of entries) {
      const list = byTable.get(e.table as SyncTable) ?? []
      list.push(e.rowId)
      byTable.set(e.table as SyncTable, list)
    }
    const rows = new Map<string, object | undefined>()
    for (const [name, ids] of byTable) {
      const found = await table(name).bulkGet(ids)
      for (const [i, id] of ids.entries()) rows.set(`${name}:${id}`, found[i])
    }
    return entries.map(e => {
      const name = e.table as SyncTable
      const row = rows.get(e.key)
      return row
        ? { tbl: name, id: e.rowId, data: serialize(name, row), deleted: false, client_ts: e.ts }
        : { tbl: name, id: e.rowId, data: null, deleted: true, client_ts: e.ts }
    })
  }

  /** Removes sent entries from the queue; an entry changed while it was being sent stays. */
  async function release(entries: Array<{ key: string; ts: number }>) {
    await db.transaction('rw', db.outbox, async () => {
      for (const e of entries) {
        const cur = await db.outbox.get(e.key)
        if (cur && cur.ts === e.ts) await db.outbox.delete(e.key)
      }
    })
    const rejected = await rejectedList()
    if (rejected.length) {
      const sent = new Set(entries.map(e => e.key))
      const left = rejected.filter(r => !sent.has(r.key))
      if (left.length !== rejected.length) await setMeta('rejected', left)
    }
  }

  /** A record the server does not accept is set aside so that it does not block the whole queue. */
  async function quarantine(entry: { key: string; ts: number }, error: string) {
    await db.transaction('rw', db.outbox, db.syncMeta, async () => {
      const cur = await db.outbox.get(entry.key)
      if (cur && cur.ts === entry.ts) await db.outbox.delete(entry.key)
      const list = (await rejectedList()).filter(r => r.key !== entry.key)
      list.push({ key: entry.key, error: error.slice(0, 200), at: Date.now() })
      await setMeta('rejected', list.slice(-50))
    })
  }

  /** Sends a batch; if the server rejects it as a whole, splits it in half until the culprit is found. */
  async function sendEntries(remote: Remote, entries: Array<{ key: string; table: string; rowId: string; ts: number }>): Promise<number> {
    try {
      await remote.push(await buildPayload(entries))
    } catch (e) {
      if (!(e instanceof PermanentRemoteError)) throw e
      if (entries.length > 1) {
        const mid = entries.length >> 1
        return (await sendEntries(remote, entries.slice(0, mid))) + (await sendEntries(remote, entries.slice(mid)))
      }
      await quarantine(entries[0], e.message)
      return 0
    }
    await release(entries)
    return entries.length
  }

  /** Sends everything in the outbox in batches. On a network error nothing is lost: the entries stay in the queue. */
  async function pushPending(remote: Remote): Promise<{ pushed: number }> {
    let pushed = 0
    for (;;) {
      const entries = await db.outbox.orderBy('ts').limit(PUSH_BATCH).toArray()
      if (!entries.length) return { pushed }
      pushed += await sendEntries(remote, entries)
    }
  }

  /* ---------- receiving ---------- */

  /** Applies records from the cloud. Your own unsynced edits that are newer are not overwritten. */
  async function applyRemote(records: RemoteRecord[]): Promise<number> {
    if (!records.length) return 0
    const byTable = new Map<SyncTable, RemoteRecord[]>()
    for (const r of records) {
      if (!SYNC_TABLES.includes(r.tbl)) continue
      const list = byTable.get(r.tbl) ?? []
      list.push(r)
      byTable.set(r.tbl, list)
    }
    let changed = 0
    await db.transaction('rw', [...SYNC_TABLES.map(n => db.table(n)), db.outbox], async () => {
      ;(Dexie.currentTransaction as TrackedTx)._asterRemote = true
      for (const [name, recs] of byTable) {
        const value3 = table(name)
        const locals = await value3.bulkGet(recs.map(r => r.id))
        const pending = await db.outbox.bulkGet(recs.map(r => `${name}:${r.id}`))
        const toPut: object[] = []
        const toDelete: string[] = []
        const supersede: string[] = []
        recs.forEach((r, i) => {
          const p = pending[i]
          if (p && p.ts > r.client_ts) return // the local edit is newer: it will go to the cloud
          if (p) supersede.push(p.key)
          const local = locals[i]
          if (r.deleted) {
            if (local) toDelete.push(r.id)
          } else if (r.data) {
            const next = mergeIncoming(name, local, r.data)
            if (!local || stable(next) !== stable(local)) toPut.push(next)
          }
        })
        if (toDelete.length) await value3.bulkDelete(toDelete)
        if (toPut.length) await value3.bulkPut(toPut as { id: string }[])
        if (supersede.length) await db.outbox.bulkDelete(supersede)
        changed += toDelete.length + toPut.length
      }
    })
    return changed
  }

  /** Fetches what is new from the cloud; returns the number of changed rows. */
  async function pullAll(remote: Remote, opts: { full?: boolean } = {}): Promise<number> {
    const cursor = opts.full ? 0 : ((await getMeta<number>('cursor')) ?? 0)
    let pos = Math.max(0, cursor - PULL_OVERLAP)
    let maxSeq = cursor
    let changed = 0
    for (;;) {
      const page = await remote.pull(pos, PULL_PAGE)
      if (!page.length) break
      changed += await applyRemote(page)
      pos = page[page.length - 1].seq
      maxSeq = Math.max(maxSeq, pos)
      if (page.length < PULL_PAGE) break
    }
    await setMeta('cursor', maxSeq)
    return changed
  }

  /** One full cycle: send first, then receive. */
  async function syncOnce(remote: Remote, opts: { full?: boolean } = {}) {
    const { pushed } = await pushPending(remote)
    const pulled = await pullAll(remote, opts)
    await setMeta('lastSyncAt', Date.now())
    return { pushed, pulled }
  }

  /* ---------- first connection and switching accounts ---------- */

  /** Queues every local row (its stamp is the time of the last edit, so a fresher cloud is not overwritten). */
  async function enqueueAll(): Promise<number> {
    let n = 0
    for (const name of SYNC_TABLES) {
      const rows = (await table(name).toArray()) as Array<{ id: string; updatedAt?: number; createdAt?: number }>
      if (!rows.length) continue
      await db.outbox.bulkPut(rows.map(r => ({ key: `${name}:${r.id}`, table: name, rowId: r.id, ts: r.updatedAt ?? r.createdAt ?? 0 })))
      n += rows.length
    }
    return n
  }

  /** Erases the local data of the synced tables without sending the deletions to the cloud. */
  async function clearLocalData() {
    await db.transaction('rw', [...SYNC_TABLES.map(n => db.table(n)), db.outbox, db.syncMeta, db.bridgeMeta, db.aiCache, db.aiUsage, db.chat], async () => {
      ;(Dexie.currentTransaction as TrackedTx)._asterRemote = true
      await Promise.all([...SYNC_TABLES.map(n => db.table(n).clear()), db.outbox.clear(), db.syncMeta.clear(), db.bridgeMeta.clear(), db.aiCache.clear(), db.aiUsage.clear(), db.chat.clear()])
    })
  }

  /** Demo data is fictional: it must not be sent to a real account. */
  async function hasDemoData() {
    return (await db.settings.get('me'))?.demo === true
  }

  async function hasLocalData() {
    for (const name of SYNC_TABLES) if (await table(name).count()) return true
    return false
  }

  return { db, installTracking, onLocalChange, getMeta, setMeta, delMeta, pendingCount, rejectedCount, clearRejected, hasDemoData, pushPending, applyRemote, pullAll, syncOnce, enqueueAll, clearLocalData, hasLocalData }
}

export type Engine = ReturnType<typeof createEngine>

/** The app's engine, bound to the main database. */
export const engine: Engine = createEngine(appDb)
export const { installTracking, onLocalChange, getMeta, setMeta, delMeta, pendingCount, rejectedCount, clearRejected, hasDemoData, pushPending, applyRemote, pullAll, syncOnce, enqueueAll, clearLocalData, hasLocalData } = engine
