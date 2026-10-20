import { AsterDB } from '@/data/db'
import { createEngine, PermanentRemoteError, type Engine, type PushRow, type Remote, type RemoteRecord } from '@/cloud/engine'

/**
 * Сервер в памяти с теми же правилами, что в SQL-функции sync_push:
 * побеждает строго больший client_ts, seq растёт при каждой принятой правке,
 * поле ai в settings вырезается.
 */
export class FakeServer {
  rows = new Map<string, RemoteRecord>()
  seq = 0
  pushes: PushRow[][] = []
  pulls: Array<{ after: number; limit: number }> = []
  failNext = 0
  /** id, которые сервер отклоняет насовсем (как нарушение ограничения) */
  poison = new Set<string>()
  /** «сейчас» сервера для зажима меток из будущего */
  nowMs = () => Date.now()
  online = true

  remote(): Remote {
    return {
      push: async rows => {
        if (!this.online) throw new Error('Failed to fetch')
        if (this.failNext > 0) { this.failNext--; throw new Error('boom') }
        if (rows.some(r => this.poison.has(r.id))) throw new PermanentRemoteError('constraint violation')
        this.pushes.push(rows)
        let applied = 0
        let stale = 0
        for (const row of rows) {
          const r = { ...row, client_ts: Math.max(0, Math.min(row.client_ts, this.nowMs() + 60_000)) }
          const key = `${r.tbl}:${r.id}`
          const cur = this.rows.get(key)
          if (cur && !(r.client_ts > cur.client_ts)) { stale++; continue }
          let data = r.deleted ? null : (JSON.parse(JSON.stringify(r.data)) as Record<string, unknown>)
          if (r.tbl === 'settings' && data) delete data.ai
          // jsonb не хранит порядок ключей
          if (data) data = Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? 1 : -1)))
          this.rows.set(key, { ...r, data, seq: ++this.seq })
          applied++
        }
        return { applied, stale }
      },
      pull: async (after, limit) => {
        if (!this.online) throw new Error('Failed to fetch')
        this.pulls.push({ after, limit })
        return [...this.rows.values()].filter(r => r.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit).map(r => structuredClone(r))
      },
    }
  }

  get(tbl: string, id: string) { return this.rows.get(`${tbl}:${id}`) }
  live(tbl: string) { return [...this.rows.values()].filter(r => r.tbl === tbl && !r.deleted) }
}

let n = 0
export interface Device { name: string; engine: Engine; db: AsterDB }

/** Отдельная база = отдельное «устройство». */
export function makeDevice(name = `dev${++n}`): Device {
  const db = new AsterDB(`aster-test-${name}-${Math.random().toString(36).slice(2)}`)
  const engine = createEngine(db)
  engine.installTracking()
  return { name, engine, db }
}

/** Ждёт, пока условие станет истинным (запись в outbox после фиксации транзакции асинхронна). */
export async function until<T>(fn: () => Promise<T> | T, ms = 3000): Promise<T> {
  const t0 = Date.now()
  let last: unknown
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) { last = e }
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error(`until: не дождались${last instanceof Error ? ` (${last.message})` : ''}`)
}

export const outboxKeys = async (d: Device) => (await d.db.outbox.toArray()).map(e => e.key).sort()
export const settle = (d: Device) => new Promise(r => setTimeout(r, 30)).then(() => d.db.outbox.count())
