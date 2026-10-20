import { beforeEach, describe, expect, it } from 'vitest'
import { addToCollection, collectionToCSV, collectionsOf, createCollection, deleteCollection, membersOf, removeFromCollection, setPersonCollections, updateCollection } from '@/data/collections'
import { db } from '@/data/db'
import { deletePerson, updateInteraction } from '@/data/actions'
import { bulkPatchPeople, findDuplicates, mergePeople } from '@/data/dedupe'
import { interaction, lead, NOW, person, reminder, resetDb } from '../helpers'

beforeEach(resetDb)

describe('списки', () => {
  it('создаёт с порядком и цветом, название обязательно', async () => {
    const a = await createCollection({ name: ' Для раунда ', emoji: '📈' })
    const b = await createCollection({ name: 'Для найма' })
    const list = await db.collections.orderBy('order').toArray()
    expect(list.map(c => [c.name, c.order])).toEqual([['Для раунда', 0], ['Для найма', 1]])
    expect(list[0]!.palette).not.toBe(list[1]!.palette)
    expect(a).not.toBe(b)
    await expect(createCollection({ name: '   ' })).rejects.toThrow('название')
  })

  it('добавляет и убирает людей и контакты резерва без дублей', async () => {
    const id = await createCollection({ name: 'Для PR', personIds: ['a', 'a'] })
    await addToCollection(id, { personIds: ['a', 'b'], leadIds: ['l1'] })
    expect(await db.collections.get(id)).toMatchObject({ personIds: ['a', 'b'], leadIds: ['l1'] })
    await removeFromCollection(id, { personIds: ['a'], leadIds: ['l1'] })
    expect(await db.collections.get(id)).toMatchObject({ personIds: ['b'], leadIds: [] })
  })

  it('переименование и удаление', async () => {
    const id = await createCollection({ name: 'Старое' })
    await updateCollection(id, { name: 'Новое', emoji: '🚀', note: 'зачем' })
    expect(await db.collections.get(id)).toMatchObject({ name: 'Новое', emoji: '🚀', note: 'зачем' })
    await expect(updateCollection(id, { name: '' })).rejects.toThrow()
    await deleteCollection(id)
    expect(await db.collections.get(id)).toBeUndefined()
  })

  it('человек в нескольких списках: одним действием', async () => {
    const a = await createCollection({ name: 'А' })
    const b = await createCollection({ name: 'Б', personIds: ['p'] })
    const c = await createCollection({ name: 'В' })
    await setPersonCollections('p', [a, c])
    const cs = await db.collections.toArray()
    expect(collectionsOf(cs, 'p').map(x => x.id).sort()).toEqual([a, c].sort())
    expect(cs.find(x => x.id === b)?.personIds).toEqual([])
  })

  it('участники и CSV; удалённые пропускаются; кавычки экранируются', async () => {
    const id = await createCollection({ name: 'Для PR', personIds: ['p1', 'gone'], leadIds: ['l1'] })
    const p = person({ id: 'p1', firstName: 'Ева', lastName: 'Ланская', role: 'Журналист "Forbes"', channels: [{ type: 'telegram', value: 'eva' }] })
    const l = lead({ id: 'l1', firstName: 'Контакт', city: 'Дубай' })
    const c = (await db.collections.get(id))!
    const m = membersOf(c, [p], [l])
    expect(m.people).toHaveLength(1)
    expect(m.leads).toHaveLength(1)
    const csv = collectionToCSV(c, [p], [l])
    expect(csv.startsWith('﻿"Имя"')).toBe(true)
    expect(csv).toContain('"Журналист ""Forbes"""')
    expect(csv.split('\r\n')).toHaveLength(3)
    expect(csv).toContain('"резерв"')
  })

  it('удаление человека убирает его из списков', async () => {
    await db.people.add(person({ id: 'p', firstName: 'А' }))
    const id = await createCollection({ name: 'Л', personIds: ['p', 'q'] })
    await deletePerson('p')
    expect((await db.collections.get(id))?.personIds).toEqual(['q'])
  })

  it('удаление человека уносит и его семью, и их записи', async () => {
    await db.people.bulkAdd([person({ id: 'o', firstName: 'О' }), person({ id: 'k', firstName: 'К', familyOf: 'o', relation: 'child' })])
    await db.interactions.add(interaction({ personIds: ['k'] }))
    await deletePerson('o')
    expect(await db.people.count()).toBe(0)
    expect(await db.interactions.count()).toBe(0)
  })
})

describe('поиск дублей', () => {
  it('то же имя и фамилия, в том числе на другом языке; одно имя без фамилии — не дубль', () => {
    const g = findDuplicates([
      person({ id: '1', firstName: 'Алексей', lastName: 'Петров' }),
      person({ id: '2', firstName: 'Alexey', lastName: 'Petrov' }),
      person({ id: '3', firstName: 'Алексей' }),
      person({ id: '4', firstName: 'Алексей' }),
      person({ id: '5', firstName: 'Борис', lastName: 'Катин' }),
    ])
    expect(g).toHaveLength(1)
    expect(g[0]!.people.map(p => p.id).sort()).toEqual(['1', '2'])
    expect(g[0]!.reasons).toEqual(['то же имя и фамилия'])
  })

  it('общий телефон в разных записях, ник и почта без регистра; группы склеиваются', () => {
    const g = findDuplicates([
      person({ id: '1', firstName: 'А', lastName: 'Один', channels: [{ type: 'phone', value: '+7 (916) 204-18-77' }] }),
      person({ id: '2', firstName: 'Б', lastName: 'Другой', channels: [{ type: 'phone', value: '8 916 204 18 77' }, { type: 'telegram', value: '@Same_Nick' }] }),
      person({ id: '3', firstName: 'В', lastName: 'Третий', channels: [{ type: 'telegram', value: 'same_nick' }] }),
      person({ id: '4', firstName: 'Г', lastName: 'Чужой', channels: [{ type: 'phone', value: '+7 900 000-00-00' }] }),
    ])
    expect(g).toHaveLength(1)
    expect(g[0]!.people.map(p => p.id).sort()).toEqual(['1', '2', '3'])
  })

  it('семья и сайты не считаются', () => {
    expect(findDuplicates([
      person({ id: '1', firstName: 'Ева', lastName: 'Л', familyOf: 'x' }),
      person({ id: '2', firstName: 'Ева', lastName: 'Л', familyOf: 'x' }),
      person({ id: '3', firstName: 'Т', lastName: 'А', channels: [{ type: 'website', value: 'acme.io' }] }),
      person({ id: '4', firstName: 'Ф', lastName: 'Б', channels: [{ type: 'website', value: 'acme.io' }] }),
    ])).toEqual([])
  })
})

describe('объединение', () => {
  it('всё переезжает на главную карточку, лишние удаляются, последний контакт пересчитан', async () => {
    const keep = person({ id: 'k', firstName: 'Алексей', lastName: 'Петров', tags: ['AI'], notes: 'Главная', channels: [{ type: 'telegram', value: 'alex' }], createdAt: NOW - 100 * 86_400_000 })
    const dup = person({ id: 'd', firstName: 'Alexey', lastName: 'Petrov', company: 'Acme', city: 'Дубай', tags: ['AI', 'Fintech'], notes: 'Дубль', channels: [{ type: 'telegram', value: '@alex' }, { type: 'email', value: 'a@acme.io' }], createdAt: NOW - 300 * 86_400_000, closeness: 1, pinned: true, birthday: '1990-05-14' })
    const friend = person({ id: 'f', firstName: 'Друг', links: [{ personId: 'd', label: 'знакомы' }], introducedBy: 'd' })
    const kid = person({ id: 'kid', firstName: 'Ребёнок', familyOf: 'd', relation: 'child' })
    await db.people.bulkAdd([keep, dup, friend, kid])
    await db.interactions.bulkAdd([interaction({ id: 'i1', personIds: ['d'], date: NOW - 3 * 86_400_000 }), interaction({ id: 'i2', personIds: ['k', 'd'], date: NOW - 10 * 86_400_000 })])
    await db.reminders.add(reminder({ id: 'r1', personId: 'd' }))
    const cid = await createCollection({ name: 'Л', personIds: ['d', 'k'] })

    const res = await mergePeople('k', ['d'])
    expect(await db.people.get('d')).toBeUndefined()
    expect(res).toMatchObject({ id: 'k', company: 'Acme', city: 'Дубай', birthday: '1990-05-14', closeness: 1, pinned: true, nickname: 'Alexey' })
    expect(res.tags.sort()).toEqual(['AI', 'Fintech'])
    expect(res.channels.map(c => c.value).sort()).toEqual(['a@acme.io', 'alex'])
    expect(res.notes).toBe('Главная\n\nДубль')
    expect(res.createdAt).toBe(NOW - 300 * 86_400_000)
    expect((await db.interactions.get('i1'))?.personIds).toEqual(['k'])
    expect((await db.interactions.get('i2'))?.personIds).toEqual(['k']) // без дубликата id
    expect((await db.reminders.get('r1'))?.personId).toBe('k')
    expect((await db.collections.get(cid))?.personIds).toEqual(['k'])
    expect((await db.people.get('f'))).toMatchObject({ links: [{ personId: 'k', label: 'знакомы' }], introducedBy: 'k' })
    expect((await db.people.get('kid'))?.familyOf).toBe('k')
    expect((await db.people.get('k'))?.lastContactAt).toBe(NOW - 3 * 86_400_000)
  })

  it('главную карточку нельзя «слить саму в себя»; несуществующая главная — ошибка', async () => {
    await db.people.add(person({ id: 'k', firstName: 'А' }))
    await mergePeople('k', ['k'])
    expect(await db.people.get('k')).toBeDefined()
    await expect(mergePeople('нет', ['k'])).rejects.toThrow('Главная карточка')
  })
})

describe('массовая правка', () => {
  it('город и источник пачке; теги добавляются; круги добавляются и убираются', async () => {
    await db.people.bulkAdd([person({ id: 'a', firstName: 'А', tags: ['x'], circleIds: ['c1'] }), person({ id: 'b', firstName: 'Б', city: 'Москва' }), person({ id: 'c', firstName: 'В' })])
    const n = await bulkPatchPeople(['a', 'b', 'нет'], { city: ' Дубай ', metPlace: 'Web Summit', addTags: ['Web3', 'x'], addCircleIds: ['c2'], removeCircleIds: ['c1'] })
    expect(n).toBe(2)
    expect(await db.people.get('a')).toMatchObject({ city: 'Дубай', metPlace: 'Web Summit', tags: ['x', 'Web3'], circleIds: ['c2'] })
    expect(await db.people.get('b')).toMatchObject({ city: 'Дубай', tags: ['Web3', 'x'] })
    expect((await db.people.get('c'))?.city).toBeUndefined()
  })
  it('статус, ритм и архив; пустое значение очищает поле', async () => {
    await db.people.bulkAdd([person({ id: 'a', firstName: 'А', city: 'Москва' })])
    await bulkPatchPeople(['a'], { lifeStatus: 'paused', cadenceDays: 90, archived: true, city: '' })
    expect(await db.people.get('a')).toMatchObject({ lifeStatus: 'paused', cadenceDays: 90, archived: true })
    expect((await db.people.get('a'))?.city).toBeUndefined()
    await bulkPatchPeople(['a'], { lifeStatus: null, cadenceDays: null, archived: false })
    const a = (await db.people.get('a'))!
    expect(a.lifeStatus).toBeUndefined()
    expect(a.archived).toBeUndefined()
    expect(a.lifeStatusAt).toBeUndefined()
  })
})

describe('правка записи общения', () => {
  it('меняет дату, тип, участников; последний контакт пересчитывается у всех затронутых', async () => {
    await db.people.bulkAdd([person({ id: 'a', firstName: 'А', lastContactAt: NOW - 2 * 86_400_000 }), person({ id: 'b', firstName: 'Б' })])
    await db.interactions.add(interaction({ id: 'i', personIds: ['a'], type: 'meeting', date: NOW - 2 * 86_400_000 }))
    await updateInteraction('i', { personIds: ['b'], date: NOW - 20 * 86_400_000, type: 'call', title: 'Созвон', initiator: 'them' })
    expect(await db.interactions.get('i')).toMatchObject({ personIds: ['b'], type: 'call', title: 'Созвон', initiator: 'them' })
    expect((await db.people.get('a'))?.lastContactAt).toBeUndefined()
    expect((await db.people.get('b'))?.lastContactAt).toBe(NOW - 20 * 86_400_000)
  })
  it('превращение встречи в заметку убирает «контакт»; без участников нельзя; несуществующая — тишина', async () => {
    await db.people.add(person({ id: 'a', firstName: 'А', lastContactAt: NOW - 86_400_000 }))
    await db.interactions.add(interaction({ id: 'i', personIds: ['a'], type: 'meeting', date: NOW - 86_400_000 }))
    await updateInteraction('i', { type: 'note' })
    expect((await db.people.get('a'))?.lastContactAt).toBeUndefined()
    await expect(updateInteraction('i', { personIds: [] })).rejects.toThrow('участник')
    await expect(updateInteraction('нет', { title: 'x' })).resolves.toBeUndefined()
  })
})
