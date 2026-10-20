import { describe, expect, it } from 'vitest'
import {
  CADENCE_OPTIONS, CLOSENESS, cadenceLabel, cadenceOf, contactAnchor, coolingClose, dueContacts, healthLabel, isSnoozed, networkHealth, nextBirthday,
  personOfTheDay, upcomingBirthdays, warmthOf,
} from '@/data/logic'
import { DAY } from '@/lib/format'
import { NOW, contactedAgo, person } from '../helpers'

describe('ритм общения', () => {
  it('по умолчанию зависит от орбиты', () => {
    expect(cadenceOf(person({ closeness: 1 }))).toBe(14)
    expect(cadenceOf(person({ closeness: 2 }))).toBe(30)
    expect(cadenceOf(person({ closeness: 3 }))).toBe(90)
    expect(cadenceOf(person({ closeness: 4 }))).toBe(180)
  })
  it('свой ритм перекрывает орбиту, а 0 означает «без ритма»', () => {
    expect(cadenceOf(person({ closeness: 1, cadenceDays: 7 }))).toBe(7)
    expect(cadenceOf(person({ closeness: 1, cadenceDays: 0 }))).toBe(0)
  })
  it('подписи ритма', () => {
    expect(cadenceLabel(7)).toBe('Раз в неделю')
    expect(cadenceLabel(45)).toBe('Раз в 45 дн.')
    expect(CADENCE_OPTIONS.map(o => o.days)).toContain(0)
  })
})

describe('warmthOf — теплота связи', () => {
  const at = (days: number, cadence = 30) => warmthOf(contactedAgo(days, { closeness: 2, cadenceDays: cadence }), NOW)
  it.each([
    [0, 'hot'], [15, 'hot'], [16, 'warm'], [30, 'warm'], [31, 'cooling'], [60, 'cooling'], [61, 'cold'], [400, 'cold'],
  ])('%i дн. при ритме 30 → %s', (days, level) => {
    expect(at(days).level).toBe(level)
  })
  it('оценка падает с просрочкой, но остаётся в 0..100', () => {
    expect(at(0).score).toBe(100)
    expect(at(15).score).toBe(100)
    expect(at(30).score).toBe(75)
    expect(at(60).score).toBe(25)
    expect(at(75).score).toBe(0)
    expect(at(10_000).score).toBe(0)
  })
  it('dueIn показывает дни до следующего контакта (в минус — просрочка)', () => {
    expect(at(10).dueIn).toBe(20)
    expect(at(40).dueIn).toBe(-10)
  })
  it('без ритма — уровень none и бесконечный dueIn', () => {
    const w = warmthOf(contactedAgo(500, { cadenceDays: 0 }), NOW)
    expect(w.level).toBe('none')
    expect(w.dueIn).toBe(Infinity)
  })
  it('будущая дата контакта не даёт отрицательных дней', () => {
    expect(warmthOf(person({ lastContactAt: NOW + 5 * DAY, cadenceDays: 30 }), NOW).daysSince).toBe(0)
  })
  it('якорь контакта: последний контакт → дата знакомства → создание', () => {
    expect(contactAnchor(person({ lastContactAt: 123, metAt: '2020-01-01' }))).toBe(123)
    expect(contactAnchor(person({ metAt: '2020-01-01' }))).toBe(new Date(2020, 0, 1).getTime())
    expect(contactAnchor(person({ createdAt: 777 }))).toBe(777)
  })
})

describe('networkHealth и healthLabel', () => {
  it('пустая сеть — 0 без деления на ноль', () => {
    expect(networkHealth([], NOW)).toEqual({ score: 0, inRhythm: 0, tracked: 0 })
  })
  it('архивных и «без ритма» не учитывает', () => {
    const h = networkHealth([person({ archived: true }), person({ cadenceDays: 0 }), contactedAgo(1, { closeness: 1 })], NOW)
    expect(h.tracked).toBe(1)
    expect(h.score).toBe(100)
  })
  it('ближний круг весит больше дальнего', () => {
    const closeCold = networkHealth([contactedAgo(60, { closeness: 1, cadenceDays: 14 }), contactedAgo(1, { closeness: 4 })], NOW).score
    const farCold = networkHealth([contactedAgo(60, { closeness: 4, cadenceDays: 14 }), contactedAgo(1, { closeness: 1 })], NOW).score
    expect(closeCold).toBeLessThan(farCold)
  })
  it('считает, сколько связей в ритме', () => {
    const h = networkHealth([contactedAgo(5, { closeness: 1 }), contactedAgo(100, { closeness: 1 })], NOW)
    expect(h.inRhythm).toBe(1)
    expect(h.tracked).toBe(2)
  })
  it.each([[100, 'hot'], [80, 'hot'], [79, 'warm'], [60, 'warm'], [59, 'cooling'], [40, 'cooling'], [39, 'cold'], [0, 'cold']])('healthLabel(%i) → %s', (score, tone) => {
    expect(healthLabel(score).tone).toBe(tone)
  })
})

describe('dueContacts / coolingClose / snooze', () => {
  const people = [
    contactedAgo(100, { id: 'a', closeness: 3 }),
    contactedAgo(100, { id: 'b', closeness: 1 }),
    contactedAgo(1, { id: 'c', closeness: 1 }),
    contactedAgo(500, { id: 'd', closeness: 2, archived: true }),
    contactedAgo(500, { id: 'e', closeness: 2, snoozedUntil: NOW + DAY }),
    contactedAgo(500, { id: 'f', closeness: 4, cadenceDays: 0 }),
  ]
  it('вышедшие за ритм, ближние раньше; архив, «отложенных» и «без ритма» пропускает', () => {
    expect(dueContacts(people, NOW).map(x => x.p.id)).toEqual(['b', 'a'])
  })
  it('отложенный возвращается, когда срок прошёл', () => {
    expect(isSnoozed(people[4], NOW)).toBe(true)
    expect(isSnoozed(people[4], NOW + 2 * DAY)).toBe(false)
    expect(dueContacts(people, NOW + 2 * DAY).map(x => x.p.id)).toContain('e')
  })
  it('coolingClose — только две ближние орбиты, остывающие', () => {
    const ids = coolingClose([...people, contactedAgo(45, { id: 'g', closeness: 2 })], NOW).map(x => x.p.id)
    expect(ids).toEqual(['b', 'e', 'g'])
  })
})

describe('дни рождения', () => {
  it('следующий ДР и возраст', () => {
    const b = nextBirthday('1990-10-12', NOW)
    expect(b?.days).toBe(7)
    expect(b?.turning).toBe(36)
  })
  it('без года рождения возраст не считается, формат --MM-DD', () => {
    const b = nextBirthday('--10-05', NOW)
    expect(b?.days).toBe(0)
    expect(b?.turning).toBeUndefined()
  })
  it('прошедший в этом году переносится на следующий', () => {
    const b = nextBirthday('1990-10-04', NOW)
    expect(b?.days).toBe(364)
    expect(b?.turning).toBe(37)
  })
  it('мусор и пустое значение → null', () => {
    expect(nextBirthday(undefined, NOW)).toBeNull()
    expect(nextBirthday('вчера', NOW)).toBeNull()
    expect(nextBirthday('1990-13-45', NOW)).toBeNull()
    expect(nextBirthday('1990-00-10', NOW)).toBeNull()
  })
  it('29 февраля в невисокосный год — 28 февраля', () => {
    const b = nextBirthday('2000-02-29', new Date(2027, 0, 10).getTime())
    expect(new Date(b!.date).getMonth()).toBe(1)
    expect(new Date(b!.date).getDate()).toBe(28)
    const leap = nextBirthday('2000-02-29', new Date(2028, 0, 10).getTime())
    expect(new Date(leap!.date).getDate()).toBe(29)
  })
  it('upcomingBirthdays — в пределах окна, по возрастанию', () => {
    const list = upcomingBirthdays([
      person({ id: 'x', birthday: '--10-20' }), person({ id: 'y', birthday: '--10-06' }), person({ id: 'z', birthday: '--12-31' }), person({ id: 'w', birthday: '--10-06', archived: true }),
    ], 30, NOW)
    expect(list.map(x => x.p.id)).toEqual(['y', 'x'])
  })
})

describe('personOfTheDay', () => {
  const pool = [1, 2, 3].map(i => contactedAgo(100, { id: `p${i}`, closeness: 2 }))
  it('детерминирован внутри дня', () => {
    expect(personOfTheDay(pool, NOW)?.p.id).toBe(personOfTheDay(pool, NOW + 3600_000)?.p.id)
  })
  it('меняется со сменой дня', () => {
    const picks = new Set([0, 1, 2].map(i => personOfTheDay(pool, NOW + i * DAY)?.p.id))
    expect(picks.size).toBe(3)
  })
  it('пусто, если остывающих нет', () => {
    expect(personOfTheDay([contactedAgo(1, { closeness: 1 })], NOW)).toBeNull()
  })
  it('не выбирает дальнюю орбиту', () => {
    expect(personOfTheDay([contactedAgo(900, { closeness: 4 })], NOW)).toBeNull()
  })
})

it('справочник орбит согласован', () => {
  expect(Object.keys(CLOSENESS)).toHaveLength(4)
  expect(CLOSENESS[1].weight).toBeGreaterThan(CLOSENESS[4].weight)
  expect(CLOSENESS[1].cadence).toBeLessThan(CLOSENESS[4].cadence)
})
