import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptPairingCode, createPairingCode } from '@/bridge/connect'
import { bridgeCycle, type BridgeAdapter } from '@/bridge/cycle'
import { asterAdapter, mirrorId } from '@/bridge/asterAdapter'
import { META } from '@/bridge/cache'
import { peopleOverview } from '@/bridge/overview'
import { acceptSuggestion, dismissSuggestion, listSuggestions } from '@/bridge/suggestions'
import type { CommitmentData, FeedItem } from '@/bridge/protocol'
import { bridgeMeta } from '@/bridge/suggestions'
import { db } from '@/data/db'
import { deleteReminder, toggleReminder } from '@/data/actions'
import { DAY } from '@/lib/format'
import { NOW, person, resetDb } from '../helpers'
import { allScopes, Project, worldFetch } from './world'

/**
 * Aster (the real adapter on a real database) against "Orbita", which a simple publisher stands in for.
 * The servers are in-memory projects with the same rules as the SQL.
 */
const A = { label: 'Aster', url: 'https://aster.test', key: 'ka' }
const O = { label: 'Орбита', url: 'https://orbita.test', key: 'ko' }

let aster: Project, orbita: Project, f: typeof fetch
let orbitaItems: FeedItem[]
let orbitaGot: Array<{ entity: string; key: string; data: unknown }>
const orbitaAdapter: BridgeAdapter = {
  collect: async () => orbitaItems,
  apply: async rows => { orbitaGot.push(...rows.map(r => ({ entity: r.entity, key: r.key, data: r.data }))); return { links: [], changed: rows.length } },
}
const orbitaMeta = new Map<string, unknown>()
const orbitaMetaStore = { get: async <T>(k: string) => orbitaMeta.get(k) as T | undefined, set: async (k: string, v: unknown) => { orbitaMeta.set(k, JSON.parse(JSON.stringify(v))) } }

const cycleAster = () => bridgeCycle({ own: aster.own(), adapter: asterAdapter, meta: bridgeMeta, now: () => NOW, fetchImpl: f })
const cycleOrbita = () => bridgeCycle({ own: orbita.own(), adapter: orbitaAdapter, meta: orbitaMetaStore, now: () => NOW, fetchImpl: f })
const both = async () => { for (let i = 0; i < 3; i++) { await cycleAster(); await cycleOrbita() } }

const commitment = (key: string, d: Partial<CommitmentData> = {}, ms = NOW): FeedItem => ({
  entity: 'commitment', key, updated_ms: ms, deleted: false,
  data: { title: 'Прислать презентацию', direction: 'i_owe', personRef: 'o-alina', personName: 'Алина Воронцова', dueMs: NOW + 2 * DAY, createdMs: NOW - DAY, status: 'open', ...d } as unknown as Record<string, unknown>,
})
const orbitaPerson = (id: string, name: string, extra: Record<string, unknown> = {}): FeedItem => ({ entity: 'person', key: id, deleted: false, data: { name, aliases: [], ...extra } })

beforeEach(async () => {
  await resetDb()
  aster = new Project(A.url, A.key)
  orbita = new Project(O.url, O.key)
  aster.now = orbita.now = () => NOW
  f = worldFetch([aster, orbita])
  vi.stubGlobal('fetch', f) // the bridge service calls "Orbita" with an ordinary fetch
  orbitaItems = []
  orbitaGot = []
  orbitaMeta.clear()
  await db.settings.put({ id: 'me', name: 'Макс', onboarded: true, createdAt: NOW - 10 * DAY })
  const { text } = await createPairingCode(orbita.own(), O)
  await acceptPairingCode(aster.own(), A, text, allScopes, f)
})

describe('people', () => {
  it('Aster publishes people and statistics; it does not publish demo data', async () => {
    await db.people.bulkAdd([person({ id: 'a1', firstName: 'Алина', lastName: 'Воронцова', nickname: 'Аля', closeness: 2, lastContactAt: NOW - 3 * DAY })])
    await db.interactions.add({ id: 'i1', personIds: ['a1'], type: 'call', date: NOW - 3 * DAY, createdAt: NOW })
    await both()
    const feed = [...aster.feed.values()]
    expect(feed.find(r => r.entity === 'person')?.data).toEqual({ name: 'Алина Воронцова', aliases: ['Аля'] })
    expect(feed.find(r => r.entity === 'person_stats')?.data).toMatchObject({ closeness: 2, interactions: 1, lastContactAt: NOW - 3 * DAY })

    await db.settings.update('me', { demo: true })
    await both()
    expect(aster.feed.get('person:a1')?.deleted).toBe(true)
  })

  it('people with the same full name link on their own; the link goes back to Orbita through peerRef', async () => {
    await db.people.bulkAdd([person({ id: 'a1', firstName: 'Алина', lastName: 'Воронцова' }), person({ id: 'a2', firstName: 'Борис', lastName: 'Катин' })])
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова'), orbitaPerson('o-x', 'Кто-то Другой')]
    await both()
    expect([...aster.links.values()]).toEqual([expect.objectContaining({ local_id: 'a1', peer_id: 'o-alina', origin: 'auto', deleted: false })])
    expect(aster.feed.get('person:a1')?.data).toMatchObject({ peerRef: 'o-alina' })
    expect(aster.feed.get('person:a2')?.data).not.toHaveProperty('peerRef')
  })

  it('Orbita linked its person to mine: we accept the link', async () => {
    await db.people.add(person({ id: 'a1', firstName: 'Алина' }))
    orbitaItems = [orbitaPerson('o-alina', 'Совсем Другое Имя', { peerRef: 'a1' })]
    await both()
    expect(aster.links.get('a1')).toMatchObject({ peer_id: 'o-alina', deleted: false })
  })

  it('an explicit unlink: after "No" auto-linking does not come back, Orbita learns through peerRef: null', async () => {
    await db.people.add(person({ id: 'a1', firstName: 'Алина', lastName: 'Воронцова' }))
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова')]
    await both()
    const { unlinkPeople } = await import('@/bridge/service')
    const { __setBridgeDeps } = await import('@/bridge/service')
    __setBridgeDeps({ own: aster.own(), meta: bridgeMeta })
    await unlinkPeople('a1', 'o-alina')
    await both()
    expect(aster.links.get('a1')).toMatchObject({ deleted: true })
    expect(aster.feed.get('person:a1')?.data).toMatchObject({ peerRef: null })
    const ov = await peopleOverview()
    expect(ov.linked).toHaveLength(0)
    expect(ov.candidates.find(c => c.localId === 'a1' && c.peerId === 'o-alina')).toBeUndefined()
  })

  it('overview: suggestions for incomplete names', async () => {
    await db.people.add(person({ id: 'a1', firstName: 'Борис' }))
    orbitaItems = [orbitaPerson('o-boris', 'Борис Катин')]
    await both()
    const ov = await peopleOverview()
    expect(ov.candidates).toEqual([expect.objectContaining({ localId: 'a1', peerId: 'o-boris', score: 60 })])
  })
})

describe('commitments → reminders', () => {
  beforeEach(async () => {
    await db.people.add(person({ id: 'a1', firstName: 'Алина', lastName: 'Воронцова' }))
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова')]
  })

  it('a commitment becomes a reminder on the person; "owed to me" is marked', async () => {
    orbitaItems.push(commitment('c1'), commitment('c2', { title: 'Прислать договор', direction: 'owed_to_me' }))
    await both()
    const r1 = await db.reminders.get(mirrorId('c1'))
    expect(r1).toMatchObject({ personId: 'a1', text: 'Прислать презентацию', dueAt: NOW + 2 * DAY, done: false, bridgeKey: 'c1' })
    expect((await db.reminders.get(mirrorId('c2')))?.text).toBe('Жду: Прислать договор')
  })

  it('without a due date the reminder is set a week after the commitment was created', async () => {
    orbitaItems.push(commitment('c1', { dueMs: undefined, createdMs: NOW }))
    await both()
    expect((await db.reminders.get(mirrorId('c1')))?.dueAt).toBe(NOW + 7 * DAY)
  })

  it('repeated rounds do not create duplicates', async () => {
    orbitaItems.push(commitment('c1'))
    await both(); await both(); await both()
    expect(await db.reminders.count()).toBe(1)
  })

  it('the person is not linked: the reminder exists anyway and gets the person after linking', async () => {
    await db.people.update('a1', { firstName: 'Другая', lastName: 'Фамилия' })
    orbitaItems.push(commitment('c1'))
    await both()
    expect((await db.reminders.get(mirrorId('c1')))?.personId).toBeUndefined()
    const { __setBridgeDeps, linkPeople } = await import('@/bridge/service')
    __setBridgeDeps({ own: aster.own(), meta: bridgeMeta })
    await linkPeople('a1', 'o-alina')
    await both()
    expect((await db.reminders.get(mirrorId('c1')))?.personId).toBe('a1')
  })

  it('done in Aster → Orbita gets the "done" state', async () => {
    orbitaItems.push(commitment('c1'))
    await both()
    await toggleReminder(mirrorId('c1'))
    await both()
    expect(aster.feed.get('commitment_state:c1')?.data).toMatchObject({ status: 'done' })
    expect(orbitaGot.some(r => r.entity === 'commitment_state' && r.key === 'c1')).toBe(true)
  })

  it('done in Orbita (it is newer) → the reminder is closed', async () => {
    orbitaItems.push(commitment('c1', {}, NOW))
    await both()
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова'), commitment('c1', { status: 'done', doneMs: NOW + 1000 }, NOW + 2000)]
    await both()
    expect(await db.reminders.get(mirrorId('c1'))).toMatchObject({ done: true, doneAt: NOW + 1000 })
  })

  it('an edit in Aster newer than Orbita\'s is not overwritten', async () => {
    orbitaItems.push(commitment('c1', {}, NOW))
    await both()
    await db.reminders.update(mirrorId('c1'), { done: true, doneAt: NOW + 5000, updatedAt: NOW + 5000 })
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова'), commitment('c1', { title: 'Прислать презентацию (правка)' }, NOW + 1000)]
    await both()
    const r = await db.reminders.get(mirrorId('c1'))
    expect(r?.done).toBe(true)
    expect(r?.text).toBe('Прислать презентацию')
  })

  it('deleted in Orbita → the reminder disappears', async () => {
    orbitaItems.push(commitment('c1'))
    await both()
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова')]
    await both()
    expect(await db.reminders.get(mirrorId('c1'))).toBeUndefined()
  })

  it('you deleted the reminder yourself: it does not come back', async () => {
    orbitaItems.push(commitment('c1'))
    await both()
    await deleteReminder(mirrorId('c1'))
    await both(); await both()
    expect(await db.reminders.get(mirrorId('c1'))).toBeUndefined()
    expect((await db.settings.get('me'))?.bridgeHandled).toContain('rem:c1')
  })

  it('"dropped" closes the reminder', async () => {
    orbitaItems.push(commitment('c1', { status: 'dropped' }, NOW))
    await both()
    expect((await db.reminders.get(mirrorId('c1')))?.done).toBe(true)
  })
})

describe('suggestions from Orbita', () => {
  const capture = (key: string, extra: Record<string, unknown> = {}): FeedItem => ({ entity: 'capture', key, deleted: false, data: { day: '2026-10-03', title: 'Ужин у Алины', summary: 'Обсудили инвестора', kind: 'meeting', place: 'Москва', people: [{ ref: 'o-alina', name: 'Алина Воронцова' }], ...extra } })
  const fact = (key: string, title: string): FeedItem => ({ entity: 'fact', key, deleted: false, data: { title, people: [{ ref: 'o-alina', name: 'Алина' }] } })

  beforeEach(async () => {
    await db.people.add(person({ id: 'a1', firstName: 'Алина', lastName: 'Воронцова' }))
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова')]
  })

  it('a record of a meeting is a suggestion; accepting creates an interaction once', async () => {
    orbitaItems.push(capture('k1'))
    await both()
    const [s] = await listSuggestions(NOW)
    expect(s).toMatchObject({ kind: 'capture', personId: 'a1', title: 'Ужин у Алины', type: 'meeting' })
    await acceptSuggestion(s!)
    await acceptSuggestion(s!)
    const ints = await db.interactions.toArray()
    expect(ints).toHaveLength(1)
    expect(ints[0]).toMatchObject({ personIds: ['a1'], type: 'meeting', title: 'Ужин у Алины', note: 'Обсудили инвестора', place: 'Москва', bridgeKey: 'k1' })
    expect((await db.people.get('a1'))?.lastContactAt).toBe(ints[0]!.date)
    expect(await listSuggestions(NOW)).toEqual([])
  })

  it('"Hide" is remembered and does not come back', async () => {
    orbitaItems.push(capture('k1'))
    await both()
    await dismissSuggestion((await listSuggestions(NOW))[0]!)
    await both()
    expect(await listSuggestions(NOW)).toEqual([])
  })

  it('a fact is added to the card without duplicates', async () => {
    orbitaItems.push(fact('f1', 'Любит бег'), fact('f2', 'любит бег'))
    await both()
    const list = await listSuggestions(NOW)
    expect(list).toHaveLength(2)
    await acceptSuggestion(list[0]!)
    expect((await db.people.get('a1'))?.facts.map(x => x.text)).toEqual(['Любит бег'])
    expect(await listSuggestions(NOW)).toHaveLength(0) // the second one is the same fact, already on the card
  })

  it('no suggestions about unlinked people and old records', async () => {
    orbitaItems.push(capture('k1', { people: [{ ref: 'o-nobody', name: 'Никто' }] }), capture('k2', { day: '2025-01-01' }))
    await both()
    expect(await listSuggestions(NOW)).toEqual([])
  })

  it('records deleted in Orbita: the suggestion disappears', async () => {
    orbitaItems.push(capture('k1'))
    await both()
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова')]
    await both()
    expect(await listSuggestions(NOW)).toEqual([])
  })

  it('Orbita\'s caches live on the device', async () => {
    orbitaItems.push(capture('k1'))
    await both()
    expect(Object.keys((await bridgeMeta.get<Record<string, unknown>>(META.captures)) ?? {})).toEqual(['k1'])
  })
})
