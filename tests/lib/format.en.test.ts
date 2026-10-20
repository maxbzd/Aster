import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setLocale } from '@/i18n'
import { DAY, ago, agoShort, dateLong, dateShort, greeting, inDays } from '@/lib/format'
import { NOW } from '../helpers'

beforeAll(() => setLocale('en'))
afterAll(() => setLocale('ru'))

describe('English formatting', () => {
  const back = (d: number) => NOW - d * DAY
  it.each([
    [0, 'today'], [1, 'yesterday'], [2, '2 days ago'], [7, '1 week ago'], [14, '2 weeks ago'], [30, '1 month ago'], [90, '3 months ago'], [365, '1 year ago'], [800, '2 years ago'],
  ])('ago(%i days) → %s', (d, text) => expect(ago(back(d), NOW)).toBe(text))
  it('ago without a date', () => expect(ago(undefined, NOW)).toBe('never'))
  it('agoShort', () => {
    expect(agoShort(back(0), NOW)).toBe('today')
    expect(agoShort(undefined, NOW)).toBe('—')
  })
  it.each([[0, 'today'], [1, 'tomorrow'], [5, 'in 5 days'], [-3, '3 days ago']])('inDays(%i) → %s', (d, text) => expect(inDays(d)).toBe(text))
  it('dates use English month names', () => {
    expect(dateLong(new Date(2024, 4, 14))).toMatch(/May 14,? 2024|14 May 2024/)
    expect(dateShort(new Date(2026, 0, 3))).toMatch(/Jan/)
  })
  it.each([[3, 'Good night'], [8, 'Good morning'], [14, 'Good afternoon'], [20, 'Good evening']])('greeting at %i:00', (h, text) => expect(greeting(new Date(2026, 9, 5, h))).toBe(text))
})
