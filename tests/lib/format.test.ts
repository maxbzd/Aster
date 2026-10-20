import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DAY, ago, agoShort, daysBetween, fromISODate, fullName, greeting, initials, inDays, jobLine, lcFirst, startOfDay, toISODate, dateLong, dateShort,
} from '@/lib/format'
import { NOW } from '../helpers'

describe('dates', () => {
  it('startOfDay zeroes the time', () => {
    const d = new Date(startOfDay(NOW))
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0])
    expect(d.getDate()).toBe(5)
  })
  it('daysBetween counts calendar days, not 24-hour windows', () => {
    const lateEvening = new Date(2026, 9, 4, 23, 59).getTime()
    const earlyMorning = new Date(2026, 9, 5, 0, 1).getTime()
    expect(daysBetween(lateEvening, earlyMorning)).toBe(1)
    expect(daysBetween(NOW, NOW)).toBe(0)
    expect(daysBetween(NOW, NOW - 30 * DAY)).toBe(-30)
  })
  it('toISODate and fromISODate are reversible and work in local time', () => {
    expect(toISODate(NOW)).toBe('2026-10-05')
    expect(toISODate(fromISODate('2026-02-09'))).toBe('2026-02-09')
    expect(new Date(fromISODate('2026-12-31')).getHours()).toBe(0)
  })
  it('fromISODate survives incomplete strings', () => {
    expect(Number.isNaN(fromISODate('2026-05'))).toBe(false)
  })
})

describe('ago / agoShort / inDays', () => {
  const back = (d: number) => NOW - d * DAY
  it.each([
    [0, 'сегодня'], [1, 'вчера'], [2, '2 дня назад'], [6, '6 дней назад'], [7, '1 неделю назад'], [14, '2 недели назад'],
    [29, '4 недели назад'], [30, '1 месяц назад'], [90, '3 месяца назад'], [200, '7 месяцев назад'], [365, 'год назад'], [800, '2 года назад'],
  ])('ago(%i дн.) → %s', (d, text) => {
    expect(ago(back(d), NOW)).toBe(text)
  })
  it('ago without a date', () => expect(ago(undefined, NOW)).toBe('никогда'))
  it.each([[0, 'сегодня'], [3, '3 д'], [10, '1 нед'], [45, '2 мес'], [400, '1 г']])('agoShort(%i) → %s', (d, text) => {
    expect(agoShort(back(d), NOW)).toBe(text)
  })
  it('agoShort without a date', () => expect(agoShort(undefined, NOW)).toBe('—'))
  it.each([[0, 'сегодня'], [1, 'завтра'], [2, 'послезавтра'], [5, 'через 5 дней'], [-3, '3 дня назад']])('inDays(%i) → %s', (d, text) => {
    expect(inDays(d)).toBe(text)
  })
})

describe('formatting with the "current year"', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => vi.useRealTimers())
  it('the year is not shown for the current year', () => {
    expect(dateLong(new Date(2026, 4, 14))).toBe('14 мая')
    expect(dateLong(new Date(2024, 4, 14))).toBe('14 мая 2024')
    expect(dateLong(new Date(2024, 4, 14), false)).toBe('14 мая')
  })
  it('dateShort', () => expect(dateShort(new Date(2026, 0, 3))).toBe('3 янв'))
})

describe('greeting', () => {
  it.each([[3, 'Доброй ночи'], [4, 'Доброй ночи'], [5, 'Доброе утро'], [11, 'Доброе утро'], [12, 'Добрый день'], [17, 'Добрый день'], [18, 'Добрый вечер'], [23, 'Добрый вечер']])('в %i часов', (h, text) => {
    expect(greeting(new Date(2026, 9, 5, h))).toBe(text)
  })
})

describe('names and strings', () => {
  it('fullName, initials, jobLine', () => {
    expect(fullName({ firstName: 'Анна', lastName: 'Ким' })).toBe('Анна Ким')
    expect(fullName({ firstName: 'Анна' })).toBe('Анна')
    expect(initials({ firstName: 'анна', lastName: 'ким' })).toBe('АК')
    expect(initials({ firstName: '' })).toBe('·')
    expect(jobLine({ role: 'CTO', company: 'Acme' })).toBe('CTO · Acme')
    expect(jobLine({ company: 'Acme' })).toBe('Acme')
    expect(jobLine({})).toBe('')
  })
  it('lcFirst does not break abbreviations', () => {
    expect(lcFirst('Основатель')).toBe('основатель')
    expect(lcFirst('CTO в AI-проекте')).toBe('CTO в AI-проекте')
    expect(lcFirst('ООО Ромашка')).toBe('ООО Ромашка')
    expect(lcFirst('')).toBe('')
    expect(lcFirst(undefined)).toBe('')
  })
})
