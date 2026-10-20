// @vitest-environment node
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asterAdapter, mirrorId } from '@/bridge/asterAdapter'
import { bridgeMeta } from '@/bridge/cache'
import { acceptPairingCode, createPairingCode, disconnectPeer } from '@/bridge/connect'
import { bridgeCycle, type BridgeAdapter } from '@/bridge/cycle'
import { supabaseOwn } from '@/bridge/own'
import { peerPull } from '@/bridge/peer'
import { BridgeError, type FeedItem, type PulledItem } from '@/bridge/protocol'
import { db } from '@/data/db'
import { toggleReminder } from '@/data/actions'
import { person, resetDb } from '../helpers'

/**
 * A live check of the bridge on TWO real Supabase projects (Aster and Orbita), with a real anonymous exchange.
 * Skipped by default. Run it with your own throwaway projects:
 *   ASTER_E2E_URL=... ASTER_E2E_KEY=...                                          (the Aster project)
 *   ASTER_E2E_ORBITA_URL=... ASTER_E2E_ORBITA_KEY=...                            (the Orbita project)
 *   ASTER_E2E_ASTER=email:password ASTER_E2E_ORBITA=email:password npx vitest run tests/e2e/bridge
 * It needs one pre-created test user in each project; the data is cleaned up at the end.
 */
const ASTER_URL = process.env.ASTER_E2E_URL ?? ''
const ASTER_KEY = process.env.ASTER_E2E_KEY ?? ''
const ORBITA_URL = process.env.ASTER_E2E_ORBITA_URL ?? ''
const ORBITA_KEY = process.env.ASTER_E2E_ORBITA_KEY ?? ''
const [ea, pa] = (process.env.ASTER_E2E_ASTER ?? '').split(':')
const [eo, po] = (process.env.ASTER_E2E_ORBITA ?? '').split(':')
const live = !!(ea && pa && eo && po && ORBITA_URL && ORBITA_KEY && ASTER_URL && ASTER_KEY)

const A = { label: 'Aster', url: ASTER_URL, key: ASTER_KEY }
const O = { label: 'Orbita', url: ORBITA_URL, key: ORBITA_KEY }

async function login(url: string, key: string, email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  return c
}

describe.skipIf(!live)('bridge: two live Supabase projects', () => {
  let ca: SupabaseClient
  let co: SupabaseClient
  const ownA = () => supabaseOwn(ca)
  const ownO = () => supabaseOwn(co)

  // «Орбита» в этом тесте — простой издатель с записями в её проекте
  let orbitaItems: FeedItem[] = []
  const got: PulledItem[] = []
  const orbitaAdapter: BridgeAdapter = {
    collect: async () => orbitaItems,
    apply: async rows => { got.push(...rows); return { links: [], changed: rows.length } },
  }
  const orbitaMeta = new Map<string, unknown>()
  const orbitaMetaStore = { get: async <T>(k: string) => orbitaMeta.get(k) as T | undefined, set: async (k: string, v: unknown) => { orbitaMeta.set(k, v) } }

  const cycleAster = () => bridgeCycle({ own: ownA(), adapter: asterAdapter, meta: bridgeMeta })
  const cycleOrbita = () => bridgeCycle({ own: ownO(), adapter: orbitaAdapter, meta: orbitaMetaStore })
  const rounds = async () => { for (let i = 0; i < 3; i++) { await cycleAster(); await cycleOrbita() } }

  const wipeBridge = async (c: SupabaseClient) => {
    for (const x of await supabaseOwn(c).listConnections()) await supabaseOwn(c).disconnect(x.id)
  }

  beforeAll(async () => {
    ca = await login(ASTER_URL, ASTER_KEY, ea!, pa!)
    co = await login(ORBITA_URL, ORBITA_KEY, eo!, po!)
    await wipeBridge(ca)
    await wipeBridge(co)
  }, 40_000)

  afterAll(async () => {
    if (!live) return
    await wipeBridge(ca)
    await wipeBridge(co)
  })

  beforeEach(async () => {
    await resetDb()
    orbitaMeta.clear()
    got.length = 0
    orbitaItems = []
    await db.settings.put({ id: 'me', name: 'Sam', onboarded: true, createdAt: Date.now() - 86_400_000 })
  })

  it('без входа создать код нельзя, анонимно читать витрину нельзя', async () => {
    const anon = createClient(ASTER_URL, ASTER_KEY, { auth: { persistSession: false } })
    const offer = await anon.rpc('bridge_create_offer', { p_label: 'x', p_scopes: ['people'] })
    expect(offer.error).not.toBeNull()
    const feed = await anon.from('bridge_feed').select('*')
    expect(feed.data ?? []).toEqual([])
    const direct = await ca.from('bridge_feed').select('*')
    expect(direct.error).not.toBeNull() // даже вошедший читает только через функции
    await expect(peerPull({ url: ASTER_URL, key: ASTER_KEY }, `bt_${'0'.repeat(64)}`, 0, 10)).rejects.toMatchObject({ kind: 'revoked' })
  }, 30_000)

  it('подключение по коду: код одноразовый, ключи работают в обе стороны', async () => {
    const { text } = await createPairingCode(ownA(), A)
    const id = await acceptPairingCode(ownO(), O, text)
    const [connA] = await ownA().listConnections()
    const [connO] = await ownO().listConnections()
    expect(connA).toMatchObject({ peer_label: 'Orbita', peer_url: ORBITA_URL })
    expect(connO).toMatchObject({ id, peer_label: 'Aster', peer_url: ASTER_URL })
    // тот же код второй раз — отказ, и у принимающего ничего не остаётся
    await expect(acceptPairingCode(ownO(), O, text)).rejects.toMatchObject({ kind: 'code-expired' })
    expect(await ownO().listConnections()).toHaveLength(1)
    // ключи настоящие: читаем витрины друг друга
    await expect(peerPull({ url: ORBITA_URL, key: ORBITA_KEY }, connA!.outbound_token!, 0, 10)).resolves.toMatchObject({ rows: expect.any(Array) })
    await expect(peerPull({ url: ASTER_URL, key: ASTER_KEY }, connO!.outbound_token!, 0, 10)).resolves.toMatchObject({ rows: expect.any(Array) })
  }, 60_000)

  it('люди связываются сами, обязательство становится напоминанием, выполнение возвращается', async () => {
    await db.people.add(person({ id: 'a1', firstName: 'Алина', lastName: 'Воронцова' }))
    orbitaItems = [
      { entity: 'person', key: 'o-alina', deleted: false, data: { name: 'Алина Воронцова', aliases: [] } },
      { entity: 'commitment', key: 'c1', deleted: false, updated_ms: Date.now() - 1000, data: { title: 'Прислать презентацию', direction: 'i_owe', personRef: 'o-alina', personName: 'Алина Воронцова', dueMs: Date.now() + 2 * 86_400_000, createdMs: Date.now() - 86_400_000, status: 'open' } },
    ]
    await rounds()
    const links = await ownA().listLinks()
    expect(links).toEqual([expect.objectContaining({ local_id: 'a1', peer_id: 'o-alina', origin: 'auto', deleted: false })])
    expect(await db.reminders.get(mirrorId('c1'))).toMatchObject({ personId: 'a1', text: 'Прислать презентацию', done: false, bridgeKey: 'c1' })

    await toggleReminder(mirrorId('c1'))
    await rounds()
    const state = got.find(r => r.entity === 'commitment_state' && r.key === 'c1' && (r.data as { status?: string } | null)?.status === 'done')
    expect(state).toBeDefined()
    // Aster сообщил Орбите, с кем связан её человек (peerRef в записи о человеке)
    expect(got.find(r => r.entity === 'person' && r.key === 'a1')?.data).toMatchObject({ name: 'Алина Воронцова', peerRef: 'o-alina' })
  }, 90_000)

  it('Aster публикует людей и статистику; Орбита их получает', async () => {
    await db.people.add(person({ id: 'a2', firstName: 'Борис', lastName: 'Катин', closeness: 2 }))
    await rounds()
    expect(got.some(r => r.entity === 'person' && r.key === 'a2' && (r.data as { name?: string } | null)?.name === 'Борис Катин')).toBe(true)
    expect(got.some(r => r.entity === 'person_stats' && r.key === 'a2')).toBe(true)
  }, 60_000)

  it('разрешения владельца режут то, что читает другая сторона', async () => {
    orbitaItems = [{ entity: 'capture', key: 'k1', deleted: false, data: { day: '2026-10-01', title: 'Ужин', kind: 'meeting', people: [] } }, { entity: 'person', key: 'p', deleted: false, data: { name: 'Кто-то', aliases: [] } }]
    await rounds()
    const [connO] = await ownO().listConnections()
    await ownO().setScopes(connO!.id, ['people'])
    const [connA] = await ownA().listConnections()
    const page = await peerPull({ url: ORBITA_URL, key: ORBITA_KEY }, connA!.outbound_token!, 0, 100)
    expect(page.rows.length).toBeGreaterThan(0)
    expect(page.rows.every(r => r.entity === 'person')).toBe(true) // записей о встречах (capture) нет
  }, 60_000)

  it('отключение: ключ сразу перестаёт работать с обеих сторон', async () => {
    const [connA] = await ownA().listConnections()
    const [connO] = await ownO().listConnections()
    await disconnectPeer(ownO(), connO!)
    expect(await ownO().listConnections()).toHaveLength(0)
    expect(await ownA().listConnections()).toHaveLength(0)
    await expect(peerPull({ url: ASTER_URL, key: ASTER_KEY }, connO!.outbound_token!, 0, 10)).rejects.toBeInstanceOf(BridgeError)
    await expect(peerPull({ url: ORBITA_URL, key: ORBITA_KEY }, connA!.outbound_token!, 0, 10)).rejects.toBeInstanceOf(BridgeError)
  }, 60_000)
})
