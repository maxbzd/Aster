// @vitest-environment node
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SyncController } from '@/cloud/controller'
import { supabaseRemote } from '@/cloud/remote'
import { makeDevice, until, type Device } from '../cloud/fake'
import { circleOf, personOf } from '../cloud/rows'

/**
 * A live check against a real Supabase project. Skipped by default.
 * Run: ASTER_E2E_URL=... ASTER_E2E_KEY=... ASTER_E2E_USER1=email:password ASTER_E2E_USER2=email:password npx vitest run tests/e2e/cloud
 * It needs two pre-created test users; the data is cleaned up at the end.
 */
const SUPABASE_URL = process.env.ASTER_E2E_URL ?? ''
const SUPABASE_KEY = process.env.ASTER_E2E_KEY ?? ''
const [e1, p1] = (process.env.ASTER_E2E_USER1 ?? '').split(':')
const [e2, p2] = (process.env.ASTER_E2E_USER2 ?? '').split(':')
const live = !!(e1 && p1 && e2 && p2 && SUPABASE_URL && SUPABASE_KEY)

const fresh = () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
async function login(email: string, password: string) {
  const c = fresh()
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  return { c, uid: data.user.id }
}

describe.skipIf(!live)('cloud: live Supabase', () => {
  let A: SupabaseClient, B: SupabaseClient, other: SupabaseClient
  let uid1 = ''
  const devs: Device[] = []

  beforeAll(async () => {
    const [a, b, o] = await Promise.all([login(e1, p1), login(e1, p1), login(e2, p2)])
    A = a.c; B = b.c; other = o.c; uid1 = a.uid
    // a clean start
    await A.rpc('delete_my_data')
    await other.rpc('delete_my_data')
  }, 30_000)

  afterAll(async () => {
    if (!live) return
    await A.rpc('delete_my_data')
    await other.rpc('delete_my_data')
  })

  const device = () => { const d = makeDevice(); devs.push(d); return d }
  const names = async (d: Device) => (await d.db.people.toArray()).map(p => p.firstName).sort()

  it('two devices of one account exchange data through the server', async () => {
    const a = device()
    const b = device()
    await a.db.people.bulkAdd([personOf('p1', { firstName: 'Анна' }), personOf('p2', { firstName: 'Борис' })])
    await a.db.circles.add(circleOf('c1'))
    await a.db.settings.add({ id: 'me', name: 'Макс', onboarded: true, createdAt: 1, ai: { mode: 'key', apiKey: 'sk-ant-СЕКРЕТ', model: 'm', shareNotes: false, webSearch: false } })
    await until(async () => (await a.db.outbox.count()) === 4)

    await a.engine.syncOnce(supabaseRemote(A))
    await b.engine.syncOnce(supabaseRemote(B))
    expect(await names(b)).toEqual(['Анна', 'Борис'])
    expect(await b.db.circles.count()).toBe(1)
    expect((await b.db.settings.get('me'))?.name).toBe('Макс')
    expect((await b.db.settings.get('me'))?.ai).toBeUndefined()

    // Astra's key did not reach the server
    const { data } = await A.from('records').select('data').eq('tbl', 'settings').eq('id', 'me').single()
    expect(JSON.stringify(data)).not.toContain('СЕКРЕТ')

    // an edit and a deletion both ways
    await b.db.people.update('p1', { firstName: 'Анна-Мария' })
    await b.db.people.delete('p2')
    await until(async () => (await b.db.outbox.count()) === 2)
    await b.engine.syncOnce(supabaseRemote(B))
    await a.engine.syncOnce(supabaseRemote(A))
    expect(await names(a)).toEqual(['Анна-Мария'])
  }, 60_000)

  it('Realtime: an edit from another device appears without a manual sync', async () => {
    const a = device()
    const b = device()
    await a.engine.syncOnce(supabaseRemote(A)) // pull what is current
    let ready!: () => void
    const subscribed = new Promise<void>(r => { ready = r })
    const trace: string[] = []
    const ctl = new SyncController({
      remote: supabaseRemote(A), engine: a.engine, userId: uid1, report: p => trace.push(JSON.stringify(p)), pollMs: 3_600_000, debounceMs: 50,
      subscribe: ping => {
        const ch = A.channel('e2e-records').on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${uid1}` }, () => { trace.push('ping'); ping() }).subscribe(s => { trace.push(`ch:${s}`); if (s === 'SUBSCRIBED') ready() })
        return () => { void A.removeChannel(ch) }
      },
    })
    try {
      await ctl.start()
      await Promise.race([subscribed, new Promise((_, rej) => setTimeout(() => rej(new Error('Realtime не подключился')), 15_000))])
      await new Promise(r => setTimeout(r, 1000)) // right after SUBSCRIBED the server is still finishing registering the subscription
      await b.engine.syncOnce(supabaseRemote(B))
      await b.db.people.add(personOf('rt1', { firstName: 'Реалтайм' }))
      await until(async () => (await b.db.outbox.count()) === 1)
      await b.engine.syncOnce(supabaseRemote(B))
      await until(async () => a.db.people.get('rt1'), 15_000).catch(e => { throw new Error(`${e.message}; trace=${trace.join(' | ')}`) })
    } finally {
      ctl.stop()
    }
  }, 60_000)

  it('another account\'s data is unavailable for both reading and writing', async () => {
    const { data, error } = await other.from('records').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
    // the same id for another user is an independent record
    const r = await other.rpc('sync_push', { rows: [{ tbl: 'people', id: 'p1', data: { id: 'p1', firstName: 'Чужой' }, deleted: false, client_ts: 1 }] })
    expect(r.error).toBeNull()
    const mine = await A.from('records').select('data').eq('tbl', 'people').eq('id', 'p1').single()
    expect((mine.data?.data as { firstName: string } | undefined)?.firstName).toBe('Анна-Мария')
    // and erasing your own does not touch the other's
    await other.rpc('delete_my_data')
    const still = await A.from('records').select('id').eq('tbl', 'people')
    expect((still.data ?? []).length).toBeGreaterThan(0)
  }, 30_000)

  it('without signing in the cloud is closed', async () => {
    const anon = fresh()
    const read = await anon.from('records').select('*')
    expect(read.data ?? []).toEqual([])
    const push = await anon.rpc('sync_push', { rows: [] })
    expect(push.error).not.toBeNull()
    const direct = await A.from('records').insert({ tbl: 'people', id: 'direct', data: {}, client_ts: 1 })
    expect(direct.error).not.toBeNull()
    const upd = await A.from('records').update({ data: { hacked: true } }).eq('id', 'p1').select()
    expect(upd.data ?? []).toEqual([])
  }, 30_000)

  it('300 records: go out in batches and arrive whole on a clean device', async () => {
    const a = device()
    const fresh1 = device()
    await a.db.people.bulkAdd(Array.from({ length: 300 }, (_, i) => personOf(`bulk${i}`, { firstName: `Человек ${i}` })))
    await until(async () => (await a.db.outbox.count()) === 300)
    const t0 = Date.now()
    await a.engine.syncOnce(supabaseRemote(A))
    await fresh1.engine.syncOnce(supabaseRemote(B))
    expect((await fresh1.db.people.filter(p => p.id.startsWith('bulk')).count())).toBe(300)
    expect(Date.now() - t0).toBeLessThan(30_000)
  }, 90_000)

  it('a stale edit does not overwrite a new one on the server', async () => {
    const r1 = await A.rpc('sync_push', { rows: [{ tbl: 'people', id: 'lww', data: { id: 'lww', firstName: 'Новое' }, deleted: false, client_ts: 2_000 }] })
    expect(r1.data).toEqual({ applied: 1, stale: 0 })
    const r2 = await A.rpc('sync_push', { rows: [{ tbl: 'people', id: 'lww', data: { id: 'lww', firstName: 'Старое' }, deleted: false, client_ts: 1_000 }] })
    expect(r2.data).toEqual({ applied: 0, stale: 1 })
    const row = await A.from('records').select('data').eq('id', 'lww').single()
    expect((row.data?.data as { firstName: string } | undefined)?.firstName).toBe('Новое')
  }, 30_000)

  it('the server rejects a bad record, and the client sets it aside while the others go through', async () => {
    const d = device()
    await d.db.people.bulkAdd([personOf('ok1'), personOf('x'.repeat(150)), personOf('ok2')])
    await until(async () => (await d.db.outbox.count()) === 3)
    await d.engine.pushPending(supabaseRemote(A))
    expect(await d.db.outbox.count()).toBe(0)
    expect(await d.engine.rejectedCount()).toBe(1)
    const { data } = await A.from('records').select('id').in('id', ['ok1', 'ok2'])
    expect((data ?? []).length).toBe(2)
  }, 30_000)

  it('an edit stamp from the far future is clamped to the server time', async () => {
    const far = Date.now() + 10 * 365 * 86_400_000
    await A.rpc('sync_push', { rows: [{ tbl: 'people', id: 'future', data: { id: 'future' }, deleted: false, client_ts: far }] })
    const { data } = await A.from('records').select('client_ts').eq('id', 'future').single()
    expect(Number(data?.client_ts)).toBeLessThan(Date.now() + 120_000)
  }, 30_000)
})
