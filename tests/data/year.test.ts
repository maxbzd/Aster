import { describe, expect, it } from 'vitest'
import { yearReview, yearsWithData } from '@/data/year'
import { DAY } from '@/lib/format'
import type { InteractionType } from '@/data/types'
import { interaction, NOW, person } from '../helpers'

const at = (daysAgo: number) => NOW - daysAgo * DAY
const on = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime()
const mk = (ids: string[], date: number, type: InteractionType = 'meeting', extra: object = {}) => interaction({ personIds: ids, type, date, ...extra })

describe('итоги года', () => {
  const alina = person({ id: 'al', firstName: 'Алина', city: 'Москва', createdAt: on(2025, 0, 10), closeness: 2, cadenceDays: 30 })
  const marat = person({ id: 'ma', firstName: 'Марат', city: 'Дубай', createdAt: on(2026, 2, 3), metAt: '2026-03-03', closeness: 3 })
  const olga = person({ id: 'ol', firstName: 'Ольга', city: 'Москва', createdAt: on(2024, 5, 1), closeness: 2, cadenceDays: 60 })
  const kid = person({ id: 'kid', firstName: 'Ева', familyOf: 'al', relation: 'child' })
  const ints = [
    mk(['al'], on(2026, 0, 12)), mk(['al'], on(2026, 1, 9), 'call', { initiator: 'me' }), mk(['al'], on(2026, 2, 8), 'message', { initiator: 'me' }),
    mk(['al'], on(2026, 3, 8), 'meeting', { initiator: 'me' }), mk(['al', 'ma'], on(2026, 3, 20), 'event'),
    mk(['ma'], on(2026, 4, 4), 'call'), mk(['ma'], on(2026, 5, 1), 'note'),
    mk(['kid'], on(2026, 5, 6), 'meeting'),
    // Ольга: общались в 2025, а последние полгода тишина
    mk(['ol'], on(2025, 10, 1)), mk(['ol'], on(2025, 11, 5)), mk(['ol'], on(2026, 0, 5)),
    // прошлый год для сравнения
    mk(['al'], on(2025, 0, 20)), mk(['al'], on(2025, 3, 20)),
  ]
  const people = [alina, marat, olga, kid]

  it('считает встречи, звонки, сообщения и людей; заметки и семья не идут в счёт', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.hasData).toBe(true)
    expect(r.meetings).toBe(3) // у Алины 2 + у Ольги 1; встреча с ребёнком в итоги сети не входит
    expect(r.calls).toBe(2)
    expect(r.messages).toBe(1)
    expect(r.events).toBe(1)
    expect(r.uniquePeople).toBe(3)
    expect(r.topPeople[0]?.person.id).toBe('al')
    expect(r.topPeople.map(x => x.person.id)).not.toContain('kid')
  })

  it('новые люди — по дате знакомства или добавления в этом году', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.newPeople.map(p => p.id)).toEqual(['ma'])
  })

  it('города — где были встречи: по городам людей', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.cities.find(c => c.city === 'Москва')?.count).toBeGreaterThanOrEqual(2)
    expect(r.cities.find(c => c.city === 'Дубай')?.count).toBe(1)
  })

  it('«потеряли» — кто раньше общался, а последние полгода тишина; активные не попадают', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.lost.map(x => x.person.id)).toEqual(['ol'])
  })

  it('жизненный статус «потеряли связь», поставленный в этом году, идёт первым', () => {
    const quiet = person({ id: 'q', firstName: 'Кирилл', lifeStatus: 'lost_touch', lifeStatusAt: on(2026, 6, 1) })
    const r = yearReview(2026, [...people, quiet], ints, NOW)
    expect(r.lost[0]).toMatchObject({ reason: 'status' })
    expect(r.lost[0]?.person.id).toBe('q')
  })

  it('год не закончен — это видно, и сравнение идёт с тем же отрезком прошлого года', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.partial).toBe(true)
    // в прошлом году до 5 октября контактов меньше 5 — сравнения нет
    expect(r.deltaPct).toBeNull()
    const many = [...ints, ...Array.from({ length: 6 }, (_, k) => mk(['al'], on(2025, 1 + k, 3)))]
    expect(yearReview(2026, people, many, NOW).deltaPct).not.toBeNull()
  })

  it('по месяцам: самый насыщенный месяц и серия недель', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.monthly).toHaveLength(12)
    expect(r.busiestMonth?.count).toBeGreaterThanOrEqual(2)
    expect(r.weekStreak).toBeGreaterThanOrEqual(1)
  })

  it('взаимность считается по записям года', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.reciprocity.me).toBe(3)
  })

  it('заголовок года зависит от того, как общались; пустой год — без паники', () => {
    expect(yearReview(2026, people, ints, NOW).title).toBeTruthy()
    const empty = yearReview(2024, people, [], NOW)
    expect(empty.hasData).toBe(false)
    expect(empty.title).toBe('Год впереди')
    expect(empty.topPeople).toEqual([])
    expect(empty.busiestMonth).toBeNull()
  })

  it('годы для переключателя: новые первыми, текущий всегда есть', () => {
    expect(yearsWithData(ints, NOW)).toEqual([2026, 2025])
    expect(yearsWithData([], NOW)).toEqual([2026])
    expect(at(0)).toBe(NOW)
  })
})
