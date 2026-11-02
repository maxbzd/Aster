import Dexie, { type Table, type Transaction } from 'dexie'
import { db as appDb, type AsterDB, type OutboxEntry } from '@/data/db'
import type { Settings } from '@/data/types'
import type { FieldConflict } from './merge'

/**
 * The local-first sync engine: the app always works with Dexie,
 * and the cloud is a copy that catches up in the background.
 *
 *   a change in Dexie → a hook puts the key in the outbox → push sends whole rows
 *   the cloud → pull by the seq cursor → applied to Dexie (without sending it back)
 *
 * Conflicts: the server keeps the version with the larger client_ts (sync_push), so two whole-row versions never merge there.
 * The merging happens on the device: when a row was edited here and also changed in the cloud, the two versions are
 * merged field by field against their common ancestor (`OutboxEntry.base`, see merge.ts), and the merged row is sent
 * back with a newer stamp. Only when both devices changed the same field does the newer edit win, and the older value
 * is kept in the conflict log instead of vanishing.
 */

export const SYNC_TABLES = ['people', 'interactions', 'reminders', 'circles', 'settings', 'intros', 'events', 'captures', 'leads', 'collections'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

export interface PushRow {
  tbl: SyncTable; id: string; data: Record<string, unknown> | null; deleted: boolean; client_ts: number
  /** The client_ts of the cloud version this edit is based on: the server refuses the row if the cloud has moved on. */
  base_ts?: number
}
export interface RemoteRecord extends PushRow { seq: number }
export interface Remote {
  /** `conflicts`: keys (`tbl:id`) the server did not write because the cloud had a different version than `base_ts`. */
  push(rows: PushRow[]): Promise<{ applied: number; stale: number; conflicts?: string[] }>
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

interface Dirty { table: SyncTable; id: string; /** the row before the edit (an update) */ base?: Record<string, unknown>; /** created in this transaction: there is nothing to compare with */ fresh: boolean }
type TrackedTx = Transaction & { _asterRemote?: boolean; _asterDirty?: Map<string, Dirty> }

/** What the conflict log keeps of a lost value: enough to restore it, not a whole transcript. */
const LOST_VALUE_LIMIT = 4000
export interface ConflictEntry extends FieldConflict { table: string; id: string; at: number }

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

/** A lost value, shortened if it is long, so the log stays small. */
function clip(value: unknown): unknown {
  const text = JSON.stringify(value) ?? 'null'
  return text.length <= LOST_VALUE_LIMIT ? value : `${text.slice(0, LOST_VALUE_LIMIT)}…`
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

  function mark(trans: TrackedTx | undefined, name: SyncTable, id: string | undefined, before?: object, fresh = false) {
    if (!trans || trans._asterRemote || !id) return
    let dirty = trans._asterDirty
    if (!dirty) {
      const batch = new Map<string, Dirty>()
      dirty = trans._asterDirty = batch
      // the outbox is written after the main transaction commits: it may not include this table
      trans.on('complete', () => {
        const ts = nextTs()
        const dirtyRows = [...batch.values()]
        // read-modify-write in one transaction: a row edited twice in a row keeps the base of the FIRST edit
        db.transaction('rw', db.outbox, db.syncMeta, async () => {
          const keys = dirtyRows.map(d => `${d.table}:${d.id}`)
          const existing = await db.outbox.bulkGet(keys)
          const versions = await db.syncMeta.bulkGet(keys.map(k => `v:${k}`))
          await db.outbox.bulkPut(dirtyRows.map((d, i) => {
            const entry: OutboxEntry = { key: keys[i], table: d.table, rowId: d.id, ts }
            const old = existing[i]
            const base = old ? old.base : d.fresh ? undefined : d.base
            const baseTs = old ? old.baseTs : d.fresh ? undefined : (versions[i]?.value as number | undefined)
            if (base) entry.base = base
            if (baseTs !== undefined) entry.baseTs = baseTs
            return entry
          }))
        })
          .then(() => { for (const fn of listeners) fn() })
          .catch(() => undefined)
      })
    }
    // the first operation on a row in this transaction decides what its base is
    if (!dirty.has(`${name}:${id}`)) dirty.set(`${name}:${id}`, { table: name, id, base: before ? serialize(name, before) : undefined, fresh })
  }

  /** Subscribes to create, update and delete in the synced tables. Safe to call again. */
  function installTracking() {
    if (installed) return
    installed = true
    for (const name of SYNC_TABLES) {
      const value2 = db.table(name)
      value2.hook('creating', (_pk, obj, trans) => { mark(trans as TrackedTx, name, (obj as { id?: string }).id, undefined, true) })
      value2.hook('updating', (mods, pk, obj, trans) => {
        // an edit of local-only fields (for example the API key) does not go to the cloud
        if (name === 'settings' && Object.keys(mods).every(isDeviceOnly)) return
        mark(trans as TrackedTx, name, String(pk), obj)
      })
      value2.hook('deleting', (pk, _obj, trans) => { mark(trans as TrackedTx, name, String(pk)) })
    }
  }

  /* ---------- bookkeeping ---------- */

  const getMeta = async <T>(key: string): Promise<T | undefined> => (await db.syncMeta.get(key))?.value as T | undefined
  const setMeta = (key: string, value: unknown) => db.syncMeta.put({ key, value })
  const delMeta = (key: string) => db.syncMeta.delete(key)
  const pendingCount = () => db.outbox.count()

  /** The last fields where two devices disagreed and the older value lost: the value is kept here so it can be restored. */
  const CONFLICT_LOG_LIMIT = 100
  const conflictLog = async () => (await getMeta<ConflictEntry[]>('conflicts')) ?? []
  const clearConflicts = () => delMeta('conflicts')
  async function recordConflicts(entries: ConflictEntry[]) {
    await setMeta('conflicts', [...(await conflictLog()), ...entries].slice(-CONFLICT_LOG_LIMIT))
  }

  /* ---------- sending ---------- */

  const rejectedList = async () => (await getMeta<RejectedEntry[]>('rejected')) ?? []
  const rejectedCount = async () => (await rejectedList()).length
  const clearRejected = () => delMeta('rejected')

  /** Rows are built from the current state of the database: what is sent is what exists now, not what it was at the time of the edit. */
  async function buildPayload(entries: Array<{ key: string; table: string; rowId: string; ts: number; baseTs?: number }>): Promise<PushRow[]> {
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
      const out: PushRow = row
        ? { tbl: name, id: e.rowId, data: serialize(name, row), deleted: false, client_ts: e.ts }
        : { tbl: name, id: e.rowId, data: null, deleted: true, client_ts: e.ts }
      if (e.baseTs !== undefined) out.base_ts = e.baseTs
      return out
    })
  }

  /**
   * Removes sent entries from the queue. An entry changed while it was being sent stays, and what was sent becomes its
   * new base: the cloud now holds exactly that. Either way the sent stamp is remembered as the cloud's version of the row.
   */
  async function release(entries: Array<{ key: string; ts: number }>, sent: PushRow[]) {
    const sentByKey = new Map(sent.map(r => [`${r.tbl}:${r.id}`, r]))
    await db.transaction('rw', db.outbox, db.syncMeta, async () => {
      for (const e of entries) {
        await db.syncMeta.put({ key: `v:${e.key}`, value: e.ts })
        const cur = await db.outbox.get(e.key)
        if (!cur) continue
        if (cur.ts === e.ts) await db.outbox.delete(e.key)
        else {
          const row = sentByKey.get(e.key)
          const next: OutboxEntry = { ...cur, baseTs: e.ts }
          if (row?.data) next.base = row.data
          else delete next.base
          await db.outbox.put(next)
        }
      }
    })
    const rejected = await rejectedList()
    if (rejected.length) {
      const sentKeys = new Set(entries.map(e => e.key))
      const left = rejected.filter(r => !sentKeys.has(r.key))
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

  /**
   * Sends a batch; if the server rejects it as a whole, splits it in half until the culprit is found.
   * Rows the server declined because the cloud holds a newer version than their base stay in the queue (they are
   * merged after the next pull) and are reported in `conflicts`.
   */
  async function sendEntries(remote: Remote, entries: OutboxEntry[]): Promise<{ sent: number; conflicts: string[] }> {
    let payload: PushRow[]
    let result: Awaited<ReturnType<Remote['push']>>
    try {
      payload = await buildPayload(entries)
      result = await remote.push(payload)
    } catch (e) {
      if (!(e instanceof PermanentRemoteError)) throw e
      if (entries.length > 1) {
        const mid = entries.length >> 1
        const first = await sendEntries(remote, entries.slice(0, mid))
        const second = await sendEntries(remote, entries.slice(mid))
        return { sent: first.sent + second.sent, conflicts: [...first.conflicts, ...second.conflicts] }
      }
      await quarantine(entries[0], e.message)
      return { sent: 0, conflicts: [] }
    }
    const conflicts = new Set(result.conflicts ?? [])
    const done = entries.filter(e => !conflicts.has(e.key))
    await release(done, payload)
    return { sent: done.length, conflicts: [...conflicts] }
  }

  /** Sends everything in the outbox in batches. On a network error nothing is lost: the entries stay in the queue. */
  async function pushPending(remote: Remote): Promise<{ pushed: number; conflicts: number }> {
    let pushed = 0
    const waiting = new Set<string>() // declined for a conflict: they wait for the next pull
    for (;;) {
      const entries = await db.outbox.orderBy('ts').filter(e => !waiting.has(e.key)).limit(PUSH_BATCH).toArray()
      if (!entries.length) return { pushed, conflicts: waiting.size }
      const result = await sendEntries(remote, entries)
      pushed += result.sent
      for (const key of result.conflicts) waiting.add(key)
    }
  }

  /* ---------- receiving ---------- */

  /**
   * Applies records from the cloud. A row that was also edited here is merged field by field with its base, so edits of
   * different fields on two devices both survive; your own newer edit of the same field is not overwritten.
   */
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
    const lost: ConflictEntry[] = []
    // The merge code is only needed when this device has unsent edits, so it stays out of the startup bundle.
    // It is loaded here, before the transaction: awaiting a module inside a Dexie transaction would end it.
    const { mergeRecords } = (await db.outbox.count()) ? await import('./merge') : { mergeRecords: null }
    await db.transaction('rw', [...SYNC_TABLES.map(n => db.table(n)), db.outbox, db.syncMeta], async () => {
      ;(Dexie.currentTransaction as TrackedTx)._asterRemote = true
      for (const [name, recs] of byTable) {
        const value3 = table(name)
        const locals = await value3.bulkGet(recs.map(r => r.id))
        const pending = await db.outbox.bulkGet(recs.map(r => `${name}:${r.id}`))
        const toPut: object[] = []
        const toDelete: string[] = []
        const supersede: string[] = []
        const versions: Array<{ key: string; value: unknown }> = []
        const rebase: OutboxEntry[] = []
        recs.forEach((r, i) => {
          const p = pending[i]
          const local = locals[i]
          // The cloud's version of this row: the next edit made here is based on it (see `base_ts`).
          if (!p || r.client_ts >= (p.baseTs ?? 0)) versions.push({ key: `v:${name}:${r.id}`, value: r.client_ts })
          if (mergeRecords && !r.deleted && r.data && p && local && p.base) {
            // Both sides changed the row. Nothing new in the cloud since our base: our edit simply goes out later.
            if (stable(r.data) === stable(p.base)) {
              if (p.baseTs !== r.client_ts) rebase.push({ ...p, baseTs: r.client_ts })
              return
            }
            const { value, conflicts } = mergeRecords(p.base, serialize(name, local), r.data, { localTs: p.ts, remoteTs: r.client_ts })
            const merged = mergeIncoming(name, local, value)
            const at = Date.now()
            for (const c of conflicts) lost.push({ ...c, lost: clip(c.lost), table: name, id: r.id, at })
            if (stable(serialize(name, merged)) === stable(r.data)) supersede.push(p.key) // the cloud already has all of it
            else rebase.push({ ...p, ts: Math.max(nextTs(), r.client_ts + 1), base: r.data, baseTs: r.client_ts }) // goes out again, newer than both
            if (stable(merged) !== stable(local)) toPut.push(merged)
            return
          }
          if (p && p.ts > r.client_ts) {
            // the local edit is newer: it will go to the cloud, on top of this version
            if (p.baseTs !== r.client_ts) rebase.push({ ...p, baseTs: r.client_ts })
            return
          }
          if (p) supersede.push(p.key)
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
        if (rebase.length) await db.outbox.bulkPut(rebase)
        if (versions.length) await db.syncMeta.bulkPut(versions as Array<{ key: string; value: unknown }>)
        changed += toDelete.length + toPut.length
      }
    })
    if (lost.length) await recordConflicts(lost)
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

  /**
   * One full cycle: receive first, so that a row edited on two devices is merged here before anything is sent (a push
   * of a whole row would otherwise overwrite the other device's edit in the cloud); then send; then receive again to
   * pick up the cursor past our own writes.
   */
  async function syncOnce(remote: Remote, opts: { full?: boolean } = {}) {
    let pulled = await pullAll(remote, opts)
    let pushed = 0
    // A row the cloud declined (another device wrote it meanwhile) is merged by the pull and goes out again: a few rounds at most.
    for (let round = 0; round < 4; round++) {
      const r = await pushPending(remote)
      pushed += r.pushed
      if (r.pushed || r.conflicts) pulled += await pullAll(remote)
      if (!r.conflicts) break
    }
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

  return { db, installTracking, onLocalChange, getMeta, setMeta, delMeta, pendingCount, conflictLog, clearConflicts, rejectedCount, clearRejected, hasDemoData, pushPending, applyRemote, pullAll, syncOnce, enqueueAll, clearLocalData, hasLocalData }
}

export type Engine = ReturnType<typeof createEngine>

/** The app's engine, bound to the main database. */
export const engine: Engine = createEngine(appDb)
export const { installTracking, onLocalChange, getMeta, setMeta, delMeta, pendingCount, conflictLog, clearConflicts, rejectedCount, clearRejected, hasDemoData, pushPending, applyRemote, pullAll, syncOnce, enqueueAll, clearLocalData, hasLocalData } = engine
