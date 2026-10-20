import { describe, expect, it } from 'vitest'
import { yearReview, yearsWithData } from '@/data/year'
import { DAY } from '@/lib/format'
import type { InteractionType } from '@/data/types'
import { interaction, NOW, person } from '../helpers'

const at = (daysAgo: number) => NOW - daysAgo * DAY
const on = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime()
const mk = (ids: string[], date: number, type: InteractionType = 'meeting', extra: object = {}) => interaction({ personIds: ids, type, date, ...extra })

describe('year in review', () => {
  const alina = person({ id: 'al', firstName: 'Алина', city: 'Москва', createdAt: on(2025, 0, 10), closeness: 2, cadenceDays: 30 })
  const marat = person({ id: 'ma', firstName: 'Марат', city: 'Дубай', createdAt: on(2026, 2, 3), metAt: '2026-03-03', closeness: 3 })
  const olga = person({ id: 'ol', firstName: 'Ольга', city: 'Москва', createdAt: on(2024, 5, 1), closeness: 2, cadenceDays: 60 })
  const kid = person({ id: 'kid', firstName: 'Ева', familyOf: 'al', relation: 'child' })
  const ints = [
    mk(['al'], on(2026, 0, 12)), mk(['al'], on(2026, 1, 9), 'call', { initiator: 'me' }), mk(['al'], on(2026, 2, 8), 'message', { initiator: 'me' }),
    mk(['al'], on(2026, 3, 8), 'meeting', { initiator: 'me' }), mk(['al', 'ma'], on(2026, 3, 20), 'event'),
    mk(['ma'], on(2026, 4, 4), 'call'), mk(['ma'], on(2026, 5, 1), 'note'),
    mk(['kid'], on(2026, 5, 6), 'meeting'),
    // Olga: in touch in 2025, but the last six months are silent
    mk(['ol'], on(2025, 10, 1)), mk(['ol'], on(2025, 11, 5)), mk(['ol'], on(2026, 0, 5)),
    // last year for comparison
    mk(['al'], on(2025, 0, 20)), mk(['al'], on(2025, 3, 20)),
  ]
  const people = [alina, marat, olga, kid]

  it('counts meetings, calls, messages and people; notes and family do not count', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.hasData).toBe(true)
    expect(r.meetings).toBe(3) // Alina has 2 + Olga has 1; a meeting with a child is not part of the network recap
    expect(r.calls).toBe(2)
    expect(r.messages).toBe(1)
    expect(r.events).toBe(1)
    expect(r.uniquePeople).toBe(3)
    expect(r.topPeople[0]?.person.id).toBe('al')
    expect(r.topPeople.map(x => x.person.id)).not.toContain('kid')
  })

  it('new people: by the date you met or were added this year', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.newPeople.map(p => p.id)).toEqual(['ma'])
  })

  it('cities: where the meetings were, by the people\'s cities', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.cities.find(c => c.city === 'Москва')?.count).toBeGreaterThanOrEqual(2)
    expect(r.cities.find(c => c.city === 'Дубай')?.count).toBe(1)
  })

  it('"lost": who used to be in touch but the last six months are silent; active ones do not get in', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.lost.map(x => x.person.id)).toEqual(['ol'])
  })

  it('the "lost touch" life status set this year comes first', () => {
    const quiet = person({ id: 'q', firstName: 'Кирилл', lifeStatus: 'lost_touch', lifeStatusAt: on(2026, 6, 1) })
    const r = yearReview(2026, [...people, quiet], ints, NOW)
    expect(r.lost[0]).toMatchObject({ reason: 'status' })
    expect(r.lost[0]?.person.id).toBe('q')
  })

  it('the year is not over: that is visible, and the comparison is with the same stretch of last year', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.partial).toBe(true)
    // last year before 5 October there are fewer than 5 contacts: no comparison
    expect(r.deltaPct).toBeNull()
    const many = [...ints, ...Array.from({ length: 6 }, (_, k) => mk(['al'], on(2025, 1 + k, 3)))]
    expect(yearReview(2026, people, many, NOW).deltaPct).not.toBeNull()
  })

  it('by month: the busiest month and the run of weeks', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.monthly).toHaveLength(12)
    expect(r.busiestMonth?.count).toBeGreaterThanOrEqual(2)
    expect(r.weekStreak).toBeGreaterThanOrEqual(1)
  })

  it('reciprocity is computed from the year\'s records', () => {
    const r = yearReview(2026, people, ints, NOW)
    expect(r.reciprocity.me).toBe(3)
  })

  it('the year\'s headline depends on how you were in touch; an empty year, no panic', () => {
    expect(yearReview(2026, people, ints, NOW).title).toBeTruthy()
    const empty = yearReview(2024, people, [], NOW)
    expect(empty.hasData).toBe(false)
    expect(empty.title).toBe('Год впереди')
    expect(empty.topPeople).toEqual([])
    expect(empty.busiestMonth).toBeNull()
  })

  it('years for the switcher: newest first, the current one is always there', () => {
    expect(yearsWithData(ints, NOW)).toEqual([2026, 2025])
    expect(yearsWithData([], NOW)).toEqual([2026])
    expect(at(0)).toBe(NOW)
  })
})
