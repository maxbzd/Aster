import { describe, expect, it } from 'vitest'
import { birthdayICS, foldLine, reminderICS } from '@/lib/ics'
import { NOW } from '../helpers'

const lines = (ics: string) => ics.split('\r\n')

describe('foldLine (RFC 5545)', () => {
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:Привет')).toBe('SUMMARY:Привет')
  })
  it('cuts long ones at 75 octets, the continuation starts with a space', () => {
    const folded = foldLine(`SUMMARY:${'а'.repeat(80)}`)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75)
    expect(parts.slice(1).every(p => p.startsWith(' '))).toBe(true)
    expect(parts.join('').replace(/ /g, '')).toBe(`SUMMARY:${'а'.repeat(80)}`)
  })
  it('does not cut a multi-byte character in half', () => {
    const folded = foldLine(`X:${'🎂'.repeat(40)}`)
    expect(folded.split('\r\n').join('').replace(/ /g, '')).toBe(`X:${'🎂'.repeat(40)}`)
  })
})

describe('reminderICS', () => {
  const ics = reminderICS('Позвонить Ивану, обсудить; важное', NOW, 'Заметка\nвторая строка')
  it('a valid calendar frame and CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).not.toMatch(/[^\r]\n/)
  })
  it('escapes commas, semicolons and line breaks', () => {
    expect(ics).toContain('SUMMARY:Позвонить Ивану\\, обсудить\\; важное')
    expect(ics).toContain('Заметка\\nвторая строка')
  })
  it('contains a 30-minute event and an alarm', () => {
    const start = ics.match(/DTSTART:(\d{8}T\d{6}Z)/)?.[1]
    const end = ics.match(/DTEND:(\d{8}T\d{6}Z)/)?.[1]
    expect(start).toBeTruthy()
    expect(end).toBeTruthy()
    const toMs = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13))
    expect(toMs(end as string) - toMs(start as string)).toBe(30 * 60_000)
    expect(ics).toContain('BEGIN:VALARM')
  })
  it('the time in UTC matches the moment', () => {
    const d = new Date(NOW)
    const expected = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}00Z`
    expect(ics).toContain(`DTSTART:${expected}`)
  })
  it('without a note it adds no empty description', () => {
    expect(reminderICS('Тест', NOW)).not.toMatch(/^DESCRIPTION:\s*$/m)
  })
  it('no line is longer than 75 octets', () => {
    const long = reminderICS('Очень длинное название напоминания '.repeat(6), NOW)
    for (const l of lines(long)) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
  })
})

describe('birthdayICS', () => {
  it('a yearly all-day event, the end is the next day', () => {
    const ics = birthdayICS('Анна Ким', new Date(2026, 9, 14).getTime())
    expect(ics).toContain('DTSTART;VALUE=DATE:20261014')
    expect(ics).toContain('DTEND;VALUE=DATE:20261015')
    expect(ics).toContain('RRULE:FREQ=YEARLY')
  })
  it('the end of a month and a year carries over correctly', () => {
    expect(birthdayICS('X', new Date(2026, 11, 31).getTime())).toContain('DTEND;VALUE=DATE:20270101')
    expect(birthdayICS('X', new Date(2026, 9, 31).getTime())).toContain('DTEND;VALUE=DATE:20261101')
  })
})
