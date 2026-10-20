import { describe, expect, it } from 'vitest'
import { genitive, nextOccurrence, upcomingDates, yearsText } from '@/data/dates'
import { DAY } from '@/lib/format'
import { NOW, person } from '../helpers'

// NOW is Monday, 5 October 2026
describe('nextOccurrence', () => {
  it('yearly: the next one and how many years it will be', () => {
    expect(nextOccurrence('2016-10-12', true, NOW)).toMatchObject({ days: 7, years: 10 })
    expect(nextOccurrence('2016-10-05', true, NOW)).toMatchObject({ days: 0, years: 10 })
    expect(nextOccurrence('--10-04', true, NOW)?.days).toBe(364)
  })
  it('one-off: a future one exists, a past one does not, one with no year does not', () => {
    expect(nextOccurrence('2026-10-20', false, NOW)?.days).toBe(15)
    expect(nextOccurrence('2026-10-01', false, NOW)).toBeNull()
    expect(nextOccurrence('--10-20', false, NOW)).toBeNull()
  })
  it('garbage and impossible dates', () => {
    expect(nextOccurrence('вчера', true, NOW)).toBeNull()
    expect(nextOccurrence('2026-13-40', true, NOW)).toBeNull()
  })
})

describe('upcomingDates', () => {
  const owner = person({ id: 'o', firstName: 'Алина', birthday: '1990-10-10' })
  const kid = person({ id: 'k', firstName: 'Ева', familyOf: 'o', relation: 'child', birthday: '2021-10-08' })
  const dates = person({
    id: 'd',
    firstName: 'Борис',
    importantDates: [
      { id: '1', kind: 'anniversary', label: 'Годовщина свадьбы', date: '2016-10-20', yearly: true },
      { id: '2', kind: 'event', label: 'Переезд', date: '2026-10-07', yearly: false },
      { id: '3', kind: 'nameday', label: 'Именины', date: '--12-25' },
    ],
  })

  it('birthdays (family\'s included) and important dates together, in order', () => {
    const list = upcomingDates([owner, kid, dates], 30, NOW)
    expect(list.map(x => [x.key, x.days])).toEqual([['d-d-2', 2], ['b-k', 3], ['b-o', 5], ['d-d-1', 15]])
    expect(list.find(x => x.key === 'b-k')).toMatchObject({ label: 'День рождения: Ева, ребёнок Алины', contactId: 'o', years: 5 })
  })
  it('the horizon and round dates', () => {
    expect(upcomingDates([dates], 3, NOW).map(x => x.key)).toEqual(['d-d-2'])
    const jub = person({ id: 'j', firstName: 'Юбиляр', birthday: '1976-10-06' })
    expect(upcomingDates([jub], 30, NOW)[0]).toMatchObject({ years: 50, round: true })
  })
  it('archived and "no longer relevant" are silent; family without an owner too', () => {
    const arch = person({ id: 'a', firstName: 'А', birthday: '1990-10-06', archived: true })
    const gone = person({ id: 'g', firstName: 'Г', birthday: '1990-10-06', lifeStatus: 'irrelevant' })
    const orphan = person({ id: 'z', firstName: 'Сирота', familyOf: 'нет', relation: 'child', birthday: '2020-10-06' })
    expect(upcomingDates([arch, gone, orphan], 30, NOW)).toEqual([])
  })
  it('your own reminder N days ahead still shows even beyond the horizon', () => {
    const p = person({ id: 'r', firstName: 'Р', importantDates: [{ id: '1', kind: 'jubilee', label: 'Юбилей', date: '2000-11-20', remindDays: 60 }] })
    expect(upcomingDates([p], 7, NOW)).toHaveLength(1)
    const q = person({ id: 'r2', firstName: 'Р', importantDates: [{ id: '1', kind: 'jubilee', label: 'Юбилей', date: '2000-11-20' }] })
    expect(upcomingDates([q], 7, NOW)).toHaveLength(0)
  })
  it('around the turn of the year', () => {
    const p = person({ id: 'n', firstName: 'Н', birthday: '--01-02' })
    expect(upcomingDates([p], 100, new Date(2026, 11, 28, 12).getTime())[0]?.days).toBe(5)
  })
  it('the time of day does not shift the days', () => {
    const p = person({ id: 'n', firstName: 'Н', birthday: '--10-06' })
    expect(upcomingDates([p], 3, NOW + 11 * 3600_000)[0]?.days).toBe(1)
    expect(upcomingDates([p], 3, NOW - DAY / 2)[0]?.days).toBeGreaterThanOrEqual(0)
  })
})

describe('declension and years', () => {
  it.each([['Алина', 'Алины'], ['Мария', 'Марии'], ['Николай', 'Николая'], ['Игорь', 'Игоря'], ['Марк', 'Марка'], ['Юля', 'Юли']])('%s → %s', (a, b) => {
    expect(genitive(a)).toBe(b)
  })
  it('yearsText', () => {
    expect(yearsText({ kind: 'birthday', years: 5 })).toBe('исполнится 5')
    expect(yearsText({ kind: 'anniversary', years: 1 })).toBe('1 год')
    expect(yearsText({ kind: 'anniversary', years: 3 })).toBe('3 года')
    expect(yearsText({ kind: 'anniversary', years: 10 })).toBe('10 лет')
    expect(yearsText({ kind: 'event' })).toBeNull()
  })
})
