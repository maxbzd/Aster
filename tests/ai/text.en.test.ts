import { describe, expect, it } from 'vitest'
import { clauses, findMentioned, parseBirthday, parseWhen, stems, textLang } from '@/ai/local/text'
import type { Person } from '@/data/types'
import { NOW, person } from '../helpers'

// NOW is Monday, 5 October 2026
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const plus = (days: number) => iso(new Date(NOW + days * 86_400_000))

describe('text language detection', () => {
  it('goes by script', () => {
    expect(textLang('Met Anna at the conference')).toBe('en')
    expect(textLang('Познакомились с Анной на конференции')).toBe('ru')
    expect(textLang('Познакомились с Anna из Spotify')).toBe('ru')
    expect(textLang('')).toBe('en')
  })
})

describe('parseWhen in English', () => {
  it.each([
    ['call him tomorrow', plus(1)],
    ['the day after tomorrow', plus(2)],
    ['next week', plus(7)],
    ['in 3 days', plus(3)],
    ['in two weeks', plus(14)],
    ['in a month', plus(30)],
    ['in a couple of days', plus(2)],
    ['remind me in half a year', plus(182)],
    ['after the holidays', plus(21)],
    ['soon', plus(3)],
  ])('%s', (text, expected) => {
    expect(parseWhen(text, NOW)).toBe(expected)
  })

  it('weekdays are always in the future', () => {
    // NOW is Monday: "Friday" is 4 days ahead, "Monday" is a full week ahead
    expect(parseWhen('catch up on Friday', NOW)).toBe(plus(4))
    expect(parseWhen('see you next Monday', NOW)).toBe(plus(7))
  })

  it('calendar dates, with or without the year rolling over', () => {
    expect(parseWhen('on October 20th', NOW)).toBe('2026-10-20')
    expect(parseWhen('on 5 March', NOW)).toBe('2027-03-05')
    expect(parseWhen('March 5', NOW)).toBe('2027-03-05')
    expect(parseWhen('in November', NOW)).toBe('2026-11-01')
    expect(parseWhen('nothing here', NOW)).toBeNull()
  })

  it('the Russian phrases still work', () => {
    expect(parseWhen('созвонимся завтра', NOW)).toBe(plus(1))
  })
})

describe('parseBirthday in English', () => {
  it.each([
    ['His birthday is May 14', '--05-14'],
    ['birthday: 14 May', '--05-14'],
    ['born on March 3rd 1990', '1990-03-03'],
    ['bday 1st of December', '--12-01'],
  ])('%s', (text, expected) => {
    expect(parseBirthday(text)).toBe(expected)
  })
  it('does not invent dates', () => {
    expect(parseBirthday('we met in May')).toBeNull()
  })
})

describe('names and queries in English', () => {
  const people: Person[] = [person({ id: 'a', firstName: 'Anna', lastName: 'Lee' }), person({ id: 'b', firstName: 'Oliver' })]
  it("finds mentioned people, including the possessive", () => {
    expect(findMentioned("Dinner at Anna's place with Oliver", people).map(p => p.id)).toEqual(['a', 'b'])
  })
  it('drops question words but keeps the meaning', () => {
    expect(stems('Who can help me with a visa to Dubai?')).toEqual(['visa', 'dubai'])
  })
  it('splits clauses on English connectors', () => {
    expect(clauses('He loves running, and his wife is Maria. She works at Spotify')).toEqual(['He loves running', 'and his wife is Maria.', 'She works at Spotify'])
  })
})
