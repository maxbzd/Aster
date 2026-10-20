import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'

/**
 * Обновление приложения не должно терять данные: открываем базу «как у пользователя на старой версии»
 * и проверяем, что текущая схема её подхватывает.
 */
describe('миграции базы', () => {
  it('v1 → актуальная: люди и записи на месте, новые таблицы доступны', async () => {
    const legacy = new Dexie('aster')
    legacy.version(1).stores({
      people: 'id, firstName, lastName, closeness, *circleIds, *tags, lastContactAt, updatedAt',
      interactions: 'id, date, *personIds, type',
      reminders: 'id, dueAt, personId',
      circles: 'id, order',
      settings: 'id',
    })
    await legacy.table('people').put({ id: 'p1', firstName: 'Анна', closeness: 2, circleIds: ['c1'], tags: ['ai'], channels: [], facts: [], topics: [], links: [], createdAt: 1, updatedAt: 1 })
    await legacy.table('interactions').put({ id: 'i1', personIds: ['p1'], type: 'call', date: 5, createdAt: 5 })
    await legacy.table('settings').put({ id: 'me', name: 'Макс', onboarded: true, createdAt: 1 })
    legacy.close()

    const { db } = await import('@/data/db')
    await db.open()
    expect(db.verno).toBe(6)
    expect((await db.people.get('p1'))?.firstName).toBe('Анна')
    expect(await db.people.where('tags').equals('ai').count()).toBe(1)
    expect(await db.people.where('circleIds').equals('c1').count()).toBe(1)
    expect((await db.interactions.where('personIds').equals('p1').first())?.type).toBe('call')
    expect((await db.settings.get('me'))?.name).toBe('Макс')
    // таблицы из более новых версий появились и работают
    for (const t of ['intros', 'events', 'captures', 'aiCache', 'aiUsage', 'leads', 'outbox', 'syncMeta', 'bridgeMeta', 'collections', 'chat']) expect(db.table(t)).toBeDefined()
    await db.leads.put({ id: 'l1', firstName: 'Лид', createdAt: 1, updatedAt: 1, tags: ['инвестор'], channels: [], batchId: 'b' })
    expect(await db.leads.where('tags').equals('инвестор').count()).toBe(1)
    expect(await db.leads.where('batchId').equals('b').count()).toBe(1)
    // очередь синхронизации доступна после миграции
    await db.outbox.put({ key: 'people:p1', table: 'people', rowId: 'p1', ts: 1 })
    expect(await db.outbox.count()).toBe(1)
    db.close()
  })
})
