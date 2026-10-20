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
 * Aster (настоящий адаптер на настоящей базе) против «Орбиты», которую изображает простой издатель.
 * Серверы — проекты в памяти с теми же правилами, что в SQL.
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
  vi.stubGlobal('fetch', f) // сервис моста ходит в «Орбиту» обычным fetch
  orbitaItems = []
  orbitaGot = []
  orbitaMeta.clear()
  await db.settings.put({ id: 'me', name: 'Макс', onboarded: true, createdAt: NOW - 10 * DAY })
  const { text } = await createPairingCode(orbita.own(), O)
  await acceptPairingCode(aster.own(), A, text, allScopes, f)
})

describe('люди', () => {
  it('Aster публикует людей и статистику; демо-данные не публикует', async () => {
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

  it('люди с одинаковым полным именем связываются сами; связь уходит обратно в Орбиту через peerRef', async () => {
    await db.people.bulkAdd([person({ id: 'a1', firstName: 'Алина', lastName: 'Воронцова' }), person({ id: 'a2', firstName: 'Борис', lastName: 'Катин' })])
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова'), orbitaPerson('o-x', 'Кто-то Другой')]
    await both()
    expect([...aster.links.values()]).toEqual([expect.objectContaining({ local_id: 'a1', peer_id: 'o-alina', origin: 'auto', deleted: false })])
    expect(aster.feed.get('person:a1')?.data).toMatchObject({ peerRef: 'o-alina' })
    expect(aster.feed.get('person:a2')?.data).not.toHaveProperty('peerRef')
  })

  it('Орбита связала своего человека с моим — принимаем связь', async () => {
    await db.people.add(person({ id: 'a1', firstName: 'Алина' }))
    orbitaItems = [orbitaPerson('o-alina', 'Совсем Другое Имя', { peerRef: 'a1' })]
    await both()
    expect(aster.links.get('a1')).toMatchObject({ peer_id: 'o-alina', deleted: false })
  })

  it('явный разрыв: после «Нет» автосвязь не возвращается, Орбита узнаёт через peerRef: null', async () => {
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

  it('обзор: предложения по неполным именам', async () => {
    await db.people.add(person({ id: 'a1', firstName: 'Борис' }))
    orbitaItems = [orbitaPerson('o-boris', 'Борис Катин')]
    await both()
    const ov = await peopleOverview()
    expect(ov.candidates).toEqual([expect.objectContaining({ localId: 'a1', peerId: 'o-boris', score: 60 })])
  })
})

describe('обязательства → напоминания', () => {
  beforeEach(async () => {
    await db.people.add(person({ id: 'a1', firstName: 'Алина', lastName: 'Воронцова' }))
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова')]
  })

  it('обязательство становится напоминанием у человека; «мне должны» помечается', async () => {
    orbitaItems.push(commitment('c1'), commitment('c2', { title: 'Прислать договор', direction: 'owed_to_me' }))
    await both()
    const r1 = await db.reminders.get(mirrorId('c1'))
    expect(r1).toMatchObject({ personId: 'a1', text: 'Прислать презентацию', dueAt: NOW + 2 * DAY, done: false, bridgeKey: 'c1' })
    expect((await db.reminders.get(mirrorId('c2')))?.text).toBe('Жду: Прислать договор')
  })

  it('без срока напоминание ставится через неделю после создания обязательства', async () => {
    orbitaItems.push(commitment('c1', { dueMs: undefined, createdMs: NOW }))
    await both()
    expect((await db.reminders.get(mirrorId('c1')))?.dueAt).toBe(NOW + 7 * DAY)
  })

  it('повторные круги не создают дубли', async () => {
    orbitaItems.push(commitment('c1'))
    await both(); await both(); await both()
    expect(await db.reminders.count()).toBe(1)
  })

  it('человек не связан — напоминание всё равно есть, а после связи получает человека', async () => {
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

  it('выполнено в Aster → Орбита получает состояние «выполнено»', async () => {
    orbitaItems.push(commitment('c1'))
    await both()
    await toggleReminder(mirrorId('c1'))
    await both()
    expect(aster.feed.get('commitment_state:c1')?.data).toMatchObject({ status: 'done' })
    expect(orbitaGot.some(r => r.entity === 'commitment_state' && r.key === 'c1')).toBe(true)
  })

  it('выполнено в Орбите (она новее) → напоминание закрывается', async () => {
    orbitaItems.push(commitment('c1', {}, NOW))
    await both()
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова'), commitment('c1', { status: 'done', doneMs: NOW + 1000 }, NOW + 2000)]
    await both()
    expect(await db.reminders.get(mirrorId('c1'))).toMatchObject({ done: true, doneAt: NOW + 1000 })
  })

  it('правка в Aster новее правки Орбиты — не затирается', async () => {
    orbitaItems.push(commitment('c1', {}, NOW))
    await both()
    await db.reminders.update(mirrorId('c1'), { done: true, doneAt: NOW + 5000, updatedAt: NOW + 5000 })
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова'), commitment('c1', { title: 'Прислать презентацию (правка)' }, NOW + 1000)]
    await both()
    const r = await db.reminders.get(mirrorId('c1'))
    expect(r?.done).toBe(true)
    expect(r?.text).toBe('Прислать презентацию')
  })

  it('удалено в Орбите → напоминание исчезает', async () => {
    orbitaItems.push(commitment('c1'))
    await both()
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова')]
    await both()
    expect(await db.reminders.get(mirrorId('c1'))).toBeUndefined()
  })

  it('удалил напоминание сам — оно не возвращается', async () => {
    orbitaItems.push(commitment('c1'))
    await both()
    await deleteReminder(mirrorId('c1'))
    await both(); await both()
    expect(await db.reminders.get(mirrorId('c1'))).toBeUndefined()
    expect((await db.settings.get('me'))?.bridgeHandled).toContain('rem:c1')
  })

  it('«отказались» (dropped) закрывает напоминание', async () => {
    orbitaItems.push(commitment('c1', { status: 'dropped' }, NOW))
    await both()
    expect((await db.reminders.get(mirrorId('c1')))?.done).toBe(true)
  })
})

describe('предложения из Орбиты', () => {
  const capture = (key: string, extra: Record<string, unknown> = {}): FeedItem => ({ entity: 'capture', key, deleted: false, data: { day: '2026-10-03', title: 'Ужин у Алины', summary: 'Обсудили инвестора', kind: 'meeting', place: 'Москва', people: [{ ref: 'o-alina', name: 'Алина Воронцова' }], ...extra } })
  const fact = (key: string, title: string): FeedItem => ({ entity: 'fact', key, deleted: false, data: { title, people: [{ ref: 'o-alina', name: 'Алина' }] } })

  beforeEach(async () => {
    await db.people.add(person({ id: 'a1', firstName: 'Алина', lastName: 'Воронцова' }))
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова')]
  })

  it('запись о встрече — предложение; принятие создаёт взаимодействие один раз', async () => {
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

  it('«Скрыть» запоминается и не возвращается', async () => {
    orbitaItems.push(capture('k1'))
    await both()
    await dismissSuggestion((await listSuggestions(NOW))[0]!)
    await both()
    expect(await listSuggestions(NOW)).toEqual([])
  })

  it('факт добавляется в карточку без дублей', async () => {
    orbitaItems.push(fact('f1', 'Любит бег'), fact('f2', 'любит бег'))
    await both()
    const list = await listSuggestions(NOW)
    expect(list).toHaveLength(2)
    await acceptSuggestion(list[0]!)
    expect((await db.people.get('a1'))?.facts.map(x => x.text)).toEqual(['Любит бег'])
    expect(await listSuggestions(NOW)).toHaveLength(0) // второй — тот же факт, уже есть в карточке
  })

  it('про несвязанных людей и старые записи предложений нет', async () => {
    orbitaItems.push(capture('k1', { people: [{ ref: 'o-nobody', name: 'Никто' }] }), capture('k2', { day: '2025-01-01' }))
    await both()
    expect(await listSuggestions(NOW)).toEqual([])
  })

  it('записи удалены в Орбите — предложение исчезает', async () => {
    orbitaItems.push(capture('k1'))
    await both()
    orbitaItems = [orbitaPerson('o-alina', 'Алина Воронцова')]
    await both()
    expect(await listSuggestions(NOW)).toEqual([])
  })

  it('кэши Орбиты лежат на устройстве', async () => {
    orbitaItems.push(capture('k1'))
    await both()
    expect(Object.keys((await bridgeMeta.get<Record<string, unknown>>(META.captures)) ?? {})).toEqual(['k1'])
  })
})
