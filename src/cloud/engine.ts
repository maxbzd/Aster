import Dexie, { type Table, type Transaction } from 'dexie'
import { db as appDb, type AsterDB } from '@/data/db'
import type { Settings } from '@/data/types'

/**
 * Движок синхронизации «локально-первый»: приложение всегда работает с Dexie,
 * а облако — это копия, которая догоняет в фоне.
 *
 *   изменение в Dexie → хук кладёт ключ в outbox → push отправляет строки целиком
 *   облако → pull по курсору seq → применяем в Dexie (без повторной отправки)
 *
 * Конфликты решает «побеждает новейшая правка» (client_ts), как и на сервере (sync_push).
 */

export const SYNC_TABLES = ['people', 'interactions', 'reminders', 'circles', 'settings', 'intros', 'events', 'captures', 'leads', 'collections'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

export interface PushRow { tbl: SyncTable; id: string; data: Record<string, unknown> | null; deleted: boolean; client_ts: number }
export interface RemoteRecord extends PushRow { seq: number }
export interface Remote {
  push(rows: PushRow[]): Promise<{ applied: number; stale: number }>
  pull(afterSeq: number, limit: number): Promise<RemoteRecord[]>
}

/** Поля настроек, которые живут только на этом устройстве (ключи API, дата последней копии в файл). */
export const DEVICE_ONLY_SETTINGS = ['ai', 'stt', 'voice', 'lastBackupAt', 'backupSnoozeUntil'] as const
const isDeviceOnly = (path: string) => DEVICE_ONLY_SETTINGS.some(k => path === k || path.startsWith(`${k}.`))

/** Сервер отклонил запись насовсем (неверный формат, слишком большая): повтор не поможет, это не сбой сети. */
export class PermanentRemoteError extends Error {}

export interface RejectedEntry { key: string; error: string; at: number }

export const PUSH_BATCH = 100
export const PULL_PAGE = 500
/**
 * Курсор отступает назад на это число номеров: транзакции других устройств могли зафиксироваться
 * позже, чем уже виденные. Применение идемпотентно, поэтому повторное чтение безвредно.
 * Должно быть больше PUSH_BATCH.
 */
export const PULL_OVERLAP = 250

type TrackedTx = Transaction & { _asterRemote?: boolean; _asterDirty?: Map<string, { table: SyncTable; id: string }> }

let lastTs = 0
/** Монотонные метки времени: две правки одного устройства никогда не получат одинаковый ts. */
export const nextTs = () => (lastTs = Math.max(Date.now(), lastTs + 1))

/** Ключи в алфавитном порядке: jsonb в Postgres меняет порядок, а сравнивать надо содержимое. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** Строка в том виде, в каком она уходит в облако (без полей, принадлежащих только устройству). */
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

/** Движок, привязанный к конкретной базе. В приложении база одна; в тестах «устройств» может быть несколько. */
export function createEngine(db: AsterDB) {
  const table = (name: SyncTable) => db.table(name) as Table<{ id: string }, string>
  const listeners = new Set<() => void>()
  let installed = false

  /* ---------- отслеживание изменений ---------- */

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
      // outbox пишем после фиксации основной транзакции: она может не включать эту таблицу
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

  /** Подписывается на создание, правку и удаление в синхронизируемых таблицах. Безопасно вызывать повторно. */
  function installTracking() {
    if (installed) return
    installed = true
    for (const name of SYNC_TABLES) {
      const value2 = db.table(name)
      value2.hook('creating', (_pk, obj, trans) => { mark(trans as TrackedTx, name, (obj as { id?: string }).id) })
      value2.hook('updating', (mods, pk, _obj, trans) => {
        // правка только локальных полей (например, ключа API) в облако не уходит
        if (name === 'settings' && Object.keys(mods).every(isDeviceOnly)) return
        mark(trans as TrackedTx, name, String(pk))
      })
      value2.hook('deleting', (pk, _obj, trans) => { mark(trans as TrackedTx, name, String(pk)) })
    }
  }

  /* ---------- служебное состояние ---------- */

  const getMeta = async <T>(key: string): Promise<T | undefined> => (await db.syncMeta.get(key))?.value as T | undefined
  const setMeta = (key: string, value: unknown) => db.syncMeta.put({ key, value })
  const delMeta = (key: string) => db.syncMeta.delete(key)
  const pendingCount = () => db.outbox.count()

  /* ---------- отправка ---------- */

  const rejectedList = async () => (await getMeta<RejectedEntry[]>('rejected')) ?? []
  const rejectedCount = async () => (await rejectedList()).length
  const clearRejected = () => delMeta('rejected')

  /** Строки собираются из текущего состояния базы: отправляется то, что есть сейчас, а не то, что было при правке. */
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

  /** Убирает отправленные записи из очереди; запись, изменённую за время отправки, оставляет. */
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

  /** Запись, которую сервер не принимает, откладывается, чтобы не блокировать всю очередь. */
  async function quarantine(entry: { key: string; ts: number }, error: string) {
    await db.transaction('rw', db.outbox, db.syncMeta, async () => {
      const cur = await db.outbox.get(entry.key)
      if (cur && cur.ts === entry.ts) await db.outbox.delete(entry.key)
      const list = (await rejectedList()).filter(r => r.key !== entry.key)
      list.push({ key: entry.key, error: error.slice(0, 200), at: Date.now() })
      await setMeta('rejected', list.slice(-50))
    })
  }

  /** Отправляет пачку; если сервер отклонил её целиком, делит пополам, пока не найдёт виновника. */
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

  /** Отправляет всё из outbox пачками. При сетевой ошибке ничего не теряется: записи остаются в очереди. */
  async function pushPending(remote: Remote): Promise<{ pushed: number }> {
    let pushed = 0
    for (;;) {
      const entries = await db.outbox.orderBy('ts').limit(PUSH_BATCH).toArray()
      if (!entries.length) return { pushed }
      pushed += await sendEntries(remote, entries)
    }
  }

  /* ---------- получение ---------- */

  /** Применяет записи из облака. Свои несинхронизированные правки, которые новее, не затираются. */
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
          if (p && p.ts > r.client_ts) return // локальная правка новее — она уйдёт в облако
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

  /** Забирает новое из облака; возвращает число изменённых строк. */
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

  /** Один полный цикл: сначала отправка, потом получение. */
  async function syncOnce(remote: Remote, opts: { full?: boolean } = {}) {
    const { pushed } = await pushPending(remote)
    const pulled = await pullAll(remote, opts)
    await setMeta('lastSyncAt', Date.now())
    return { pushed, pulled }
  }

  /* ---------- первое подключение и смена аккаунта ---------- */

  /** Ставит в очередь все локальные строки (их метка — время последней правки, чтобы не затереть более свежее облако). */
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

  /** Стирает локальные данные синхронизируемых таблиц, не отправляя удаления в облако. */
  async function clearLocalData() {
    await db.transaction('rw', [...SYNC_TABLES.map(n => db.table(n)), db.outbox, db.syncMeta, db.bridgeMeta, db.aiCache, db.aiUsage, db.chat], async () => {
      ;(Dexie.currentTransaction as TrackedTx)._asterRemote = true
      await Promise.all([...SYNC_TABLES.map(n => db.table(n).clear()), db.outbox.clear(), db.syncMeta.clear(), db.bridgeMeta.clear(), db.aiCache.clear(), db.aiUsage.clear(), db.chat.clear()])
    })
  }

  /** Демо-данные вымышленные: их нельзя отправлять в настоящий аккаунт. */
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

/** Движок приложения, привязанный к основной базе. */
export const engine: Engine = createEngine(appDb)
export const { installTracking, onLocalChange, getMeta, setMeta, delMeta, pendingCount, rejectedCount, clearRejected, hasDemoData, pushPending, applyRemote, pullAll, syncOnce, enqueueAll, clearLocalData, hasLocalData } = engine
