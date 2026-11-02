import { describe, expect, it } from 'vitest'
import { canonical, mergeRecords, mergeText } from '@/cloud/merge'

type R = Record<string, unknown>
const merge = (base: R, local: R, remote: R, localTs = 2, remoteTs = 1) => mergeRecords(base, local, remote, { localTs, remoteTs })

describe('fields', () => {
  const base = { id: 'p1', firstName: 'Иван', company: 'Acme', city: 'Москва', updatedAt: 10 }

  it('edits of different fields on two devices both survive', () => {
    const { value, conflicts } = merge(base, { ...base, firstName: 'Иван-2', updatedAt: 20 }, { ...base, company: 'Globex', updatedAt: 15 })
    expect(value).toMatchObject({ firstName: 'Иван-2', company: 'Globex', city: 'Москва' })
    expect(conflicts).toEqual([])
  })

  it('updatedAt becomes the later of the two', () => {
    expect(merge(base, { ...base, city: 'Рим', updatedAt: 20 }, { ...base, company: 'X', updatedAt: 15 }).value.updatedAt).toBe(20)
    expect(merge(base, { ...base, city: 'Рим', updatedAt: 12 }, { ...base, company: 'X', updatedAt: 15 }).value.updatedAt).toBe(15)
  })

  it('the same field changed on both sides: the newer edit wins and the older value is reported', () => {
    const local = { ...base, city: 'Рим' }
    const remote = { ...base, city: 'Париж' }
    const newerLocal = merge(base, local, remote, 5, 4)
    expect(newerLocal.value.city).toBe('Рим')
    expect(newerLocal.conflicts).toEqual([{ path: 'city', lost: 'Париж', kept: 'local' }])
    const newerRemote = merge(base, local, remote, 4, 5)
    expect(newerRemote.value.city).toBe('Париж')
    expect(newerRemote.conflicts).toEqual([{ path: 'city', lost: 'Рим', kept: 'remote' }])
  })

  it('a field removed on one side and untouched on the other is removed', () => {
    const { value } = merge(base, { id: 'p1', firstName: 'Иван', city: 'Москва', updatedAt: 10 }, { ...base, city: 'Рим' })
    expect(value).toEqual({ id: 'p1', firstName: 'Иван', city: 'Рим', updatedAt: 10 })
  })

  it('nested objects merge field by field', () => {
    const b = { prefs: { food: 'суши', language: 'ru' } }
    const { value, conflicts } = merge(b, { prefs: { food: 'пицца', language: 'ru' } }, { prefs: { food: 'суши', language: 'en', alcohol: 'no' } })
    expect(value).toEqual({ prefs: { food: 'пицца', language: 'en', alcohol: 'no' } })
    expect(conflicts).toEqual([])
  })
})

describe('arrays', () => {
  it('lists of plain values merge as sets: what each device added is kept', () => {
    const b = { tags: ['a', 'b'] }
    const { value } = merge(b, { tags: ['a', 'b', 'c'] }, { tags: ['a', 'b', 'd'] })
    expect([...(value.tags as string[])].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('what one device removed is removed, what the other added stays', () => {
    const b = { tags: ['a', 'b', 'c'] }
    const { value } = merge(b, { tags: ['a', 'c'] }, { tags: ['a', 'b', 'c', 'd'] })
    expect([...(value.tags as string[])].sort()).toEqual(['a', 'c', 'd'])
  })

  it('an item removed on one device but edited on the other stays, with the edit', () => {
    const b = { topics: [{ id: 't1', text: 'Старый', done: false }] }
    const { value } = merge(b, { topics: [] }, { topics: [{ id: 't1', text: 'Новый', done: false }] })
    expect(value.topics).toEqual([{ id: 't1', text: 'Новый', done: false }])
  })

  it('items with an id merge field by field', () => {
    const b = { topics: [{ id: 't1', text: 'Тема', done: false }] }
    const { value } = merge(b, { topics: [{ id: 't1', text: 'Тема', done: true }] }, { topics: [{ id: 't1', text: 'Тема (уточнено)', done: false }] })
    expect(value.topics).toEqual([{ id: 't1', text: 'Тема (уточнено)', done: true }])
  })

  it('objects without an id are told apart by content', () => {
    const b = { facts: [{ icon: 'star', text: 'любит чай' }] }
    const { value } = merge(b, { facts: [{ icon: 'star', text: 'любит чай' }, { icon: 'paw', text: 'кот' }] }, { facts: [{ icon: 'star', text: 'любит чай' }, { icon: 'cake', text: 'ДР в мае' }] })
    expect(value.facts).toHaveLength(3)
  })

  it('the order does not depend on which side is "local"', () => {
    const b = { tags: ['a'] }
    const l = { tags: ['a', 'x', 'y'] }
    const r = { tags: ['a', 'z'] }
    expect(merge(b, l, r, 2, 1).value).toEqual(merge(b, r, l, 1, 2).value)
  })
})

describe('text', () => {
  const base = 'Познакомились на конференции. Любит кофе. Работает в банке.'

  it('edits in different places of one note both survive', () => {
    const local = 'Познакомились на конференции в Лиссабоне. Любит кофе. Работает в банке.'
    const remote = 'Познакомились на конференции. Любит кофе. Работает в банке, недавно сменил отдел.'
    expect(mergeText(base, local, remote)).toBe('Познакомились на конференции в Лиссабоне. Любит кофе. Работает в банке, недавно сменил отдел.')
  })

  it('a line appended on both devices keeps both lines, in the same order on every device', () => {
    const base = 'Первая строка.'
    const phone = 'Первая строка. Добавил на телефоне.'
    const laptop = 'Первая строка. Добавил на ноутбуке.'
    expect(mergeText(base, phone, laptop, true)).toBe('Первая строка. Добавил на телефоне. Добавил на ноутбуке.')
    // the other device runs the same merge with the sides swapped
    expect(mergeText(base, laptop, phone, false)).toBe('Первая строка. Добавил на телефоне. Добавил на ноутбуке.')
  })

  it('in a record, the newer appended line comes first and nothing is reported as lost', () => {
    const { value, conflicts } = merge({ notes: 'Раз.' }, { notes: 'Раз. Телефон.' }, { notes: 'Раз. Ноутбук.' }, 9, 3)
    expect(value.notes).toBe('Раз. Телефон. Ноутбук.')
    expect(conflicts).toEqual([])
  })

  it('the same edit on both sides is not a conflict', () => {
    expect(mergeText('один два три', 'один 2 три', 'один 2 три')).toBe('один 2 три')
  })

  it('overlapping different edits are a conflict', () => {
    expect(mergeText('один два три', 'один ДВА три', 'один 2 три')).toBeNull()
  })

  it('a record falls back to "the newer wins" for such text and reports the loser', () => {
    const b = { notes: 'один два три' }
    const { value, conflicts } = merge(b, { notes: 'один ДВА три' }, { notes: 'один 2 три' }, 9, 3)
    expect(value.notes).toBe('один ДВА три')
    expect(conflicts).toEqual([{ path: 'notes', lost: 'один 2 три', kept: 'local' }])
  })

  it('works with an empty base (the field was empty before)', () => {
    expect(merge({}, { notes: 'раз' }, { notes: 'два' }, 2, 1).value.notes).toBe('раз')
  })

  it('a very long text does not hang: the newer one wins', () => {
    const long = Array.from({ length: 6000 }, (_, i) => `слово${i}`).join(' ')
    expect(mergeText(long, `${long} а`, `б ${long}`)).toBeNull()
  })
})

describe('properties', () => {
  let seed = 7
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]
  const words = ['кофе', 'чай', 'банк', 'Рим', 'проект', 'встреча', 'звонок', 'идея']
  const text = () => Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => pick(words)).join(' ')
  const randomRecord = (): R => ({
    id: 'p',
    firstName: pick(['А', 'Б', 'В']),
    notes: text(),
    tags: Array.from(new Set(Array.from({ length: Math.floor(rnd() * 4) }, () => pick(words)))),
    prefs: { food: pick(['суши', 'пицца', undefined]) },
    updatedAt: Math.floor(rnd() * 100),
  })
  const mutate = (record: R): R => {
    const next = structuredClone(record) as R
    const r = rnd()
    if (r < 0.25) next.firstName = pick(['А', 'Б', 'В', 'Г'])
    else if (r < 0.5) next.notes = `${next.notes} ${pick(words)}`
    else if (r < 0.75) next.tags = [...new Set([...(next.tags as string[]), pick(words)])]
    else next.prefs = { food: pick(['суши', 'пицца', 'роллы']) }
    return next
  }

  it('is symmetric: swapping the sides and their times gives the same record', () => {
    for (let i = 0; i < 300; i++) {
      const b = randomRecord()
      const l = mutate(mutate(b))
      const r = mutate(b)
      const lt = Math.floor(rnd() * 5)
      const rt = Math.floor(rnd() * 5)
      const x = mergeRecords(b, l, r, { localTs: lt, remoteTs: rt }).value
      const y = mergeRecords(b, r, l, { localTs: rt, remoteTs: lt }).value
      expect(canonical(x)).toBe(canonical(y))
    }
  })

  it('is idempotent: merging a result with either side again changes nothing', () => {
    for (let i = 0; i < 300; i++) {
      const b = randomRecord()
      const l = mutate(b)
      const r = mutate(b)
      const m = mergeRecords(b, l, r, { localTs: 2, remoteTs: 1 }).value
      expect(canonical(mergeRecords(b, m, m, { localTs: 3, remoteTs: 3 }).value)).toBe(canonical(m))
      // after merging, "remote" is the base the next merge starts from, and the merged record is the local one
      expect(canonical(mergeRecords(r, m, r, { localTs: 3, remoteTs: 1 }).value)).toBe(canonical(m))
    }
  })

  it('never loses an edit made on only one side', () => {
    for (let i = 0; i < 300; i++) {
      const b = randomRecord()
      const l = { ...b, firstName: 'ЛОКАЛЬНО' }
      const r = { ...b, prefs: { food: 'удалённо' } }
      const { value } = mergeRecords(b, l, r, { localTs: 1, remoteTs: 2 })
      expect(value.firstName).toBe('ЛОКАЛЬНО')
      expect(value.prefs).toEqual({ food: 'удалённо' })
    }
  })
})
