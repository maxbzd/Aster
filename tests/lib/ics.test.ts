import { describe, expect, it } from 'vitest'
import { birthdayICS, foldLine, reminderICS } from '@/lib/ics'
import { NOW } from '../helpers'

const lines = (ics: string) => ics.split('\r\n')

describe('foldLine (RFC 5545)', () => {
  it('короткие строки не трогает', () => {
    expect(foldLine('SUMMARY:Привет')).toBe('SUMMARY:Привет')
  })
  it('длинные режет по 75 октетов, продолжение начинается с пробела', () => {
    const folded = foldLine(`SUMMARY:${'а'.repeat(80)}`)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75)
    expect(parts.slice(1).every(p => p.startsWith(' '))).toBe(true)
    expect(parts.join('').replace(/ /g, '')).toBe(`SUMMARY:${'а'.repeat(80)}`)
  })
  it('не режет многобайтовый символ пополам', () => {
    const folded = foldLine(`X:${'🎂'.repeat(40)}`)
    expect(folded.split('\r\n').join('').replace(/ /g, '')).toBe(`X:${'🎂'.repeat(40)}`)
  })
})

describe('reminderICS', () => {
  const ics = reminderICS('Позвонить Ивану, обсудить; важное', NOW, 'Заметка\nвторая строка')
  it('валидная рамка календаря и CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).not.toMatch(/[^\r]\n/)
  })
  it('экранирует запятые, точки с запятой и переводы строк', () => {
    expect(ics).toContain('SUMMARY:Позвонить Ивану\\, обсудить\\; важное')
    expect(ics).toContain('Заметка\\nвторая строка')
  })
  it('содержит событие на 30 минут и будильник', () => {
    const start = ics.match(/DTSTART:(\d{8}T\d{6}Z)/)?.[1]
    const end = ics.match(/DTEND:(\d{8}T\d{6}Z)/)?.[1]
    expect(start).toBeTruthy()
    expect(end).toBeTruthy()
    const toMs = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13))
    expect(toMs(end as string) - toMs(start as string)).toBe(30 * 60_000)
    expect(ics).toContain('BEGIN:VALARM')
  })
  it('время в UTC соответствует моменту', () => {
    const d = new Date(NOW)
    const expected = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}00Z`
    expect(ics).toContain(`DTSTART:${expected}`)
  })
  it('без заметки не добавляет пустое описание', () => {
    expect(reminderICS('Тест', NOW)).not.toMatch(/^DESCRIPTION:\s*$/m)
  })
  it('ни одна строка не длиннее 75 октетов', () => {
    const long = reminderICS('Очень длинное название напоминания '.repeat(6), NOW)
    for (const l of lines(long)) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
  })
})

describe('birthdayICS', () => {
  it('ежегодное событие на целый день, конец — следующий день', () => {
    const ics = birthdayICS('Анна Ким', new Date(2026, 9, 14).getTime())
    expect(ics).toContain('DTSTART;VALUE=DATE:20261014')
    expect(ics).toContain('DTEND;VALUE=DATE:20261015')
    expect(ics).toContain('RRULE:FREQ=YEARLY')
  })
  it('конец месяца и года переносится корректно', () => {
    expect(birthdayICS('X', new Date(2026, 11, 31).getTime())).toContain('DTEND;VALUE=DATE:20270101')
    expect(birthdayICS('X', new Date(2026, 9, 31).getTime())).toContain('DTEND;VALUE=DATE:20261101')
  })
})
