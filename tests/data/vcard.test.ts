import { describe, expect, it } from 'vitest'
import { parseVCards, toVCard } from '@/data/vcard'
import { person } from '../helpers'

const card = (body: string) => `BEGIN:VCARD\r\nVERSION:3.0\r\n${body}\r\nEND:VCARD`

describe('parseVCards', () => {
  it('читает основные поля', () => {
    const [p] = parseVCards(card([
      'N:Петров;Иван;;;', 'FN:Иван Петров', 'ORG:Northwind Capital;Fintech', 'TITLE:Партнёр',
      'TEL;TYPE=CELL:+971 50 123 4567', 'EMAIL;TYPE=INTERNET:ivan@northwind.vc', 'BDAY:1990-05-14', 'NOTE:Любит кофе\\, без молока',
      'ADR;TYPE=WORK:;;Sheikh Zayed Rd;Дубай;;;ОАЭ', 'URL:https://t.me/ivan_p', 'URL:https://www.linkedin.com/in/ivan-petrov',
    ].join('\r\n')))
    expect(p).toMatchObject({ firstName: 'Иван', lastName: 'Петров', company: 'Northwind Capital', role: 'Партнёр', birthday: '1990-05-14', city: 'Дубай', closeness: 4 })
    expect(p.notes).toBe('Любит кофе, без молока')
    expect(p.channels).toEqual(expect.arrayContaining([
      { type: 'phone', value: '+971 50 123 4567' },
      { type: 'email', value: 'ivan@northwind.vc' },
      { type: 'telegram', value: 'ivan_p' },
      { type: 'linkedin', value: 'https://www.linkedin.com/in/ivan-petrov' },
    ]))
  })
  it('несколько карточек в одном файле', () => {
    expect(parseVCards(`${card('FN:Анна Ким')}\r\n${card('FN:Борис Лим')}\r\n${card('FN:Вера')}`).map(p => p.firstName)).toEqual(['Анна', 'Борис', 'Вера'])
  })
  it('берёт имя из FN, если нет N', () => {
    const [p] = parseVCards(card('FN:Мария Анна Иванова'))
    expect([p.firstName, p.lastName]).toEqual(['Мария', 'Анна Иванова'])
  })
  it('если есть только фамилия — она становится именем', () => {
    const [p] = parseVCards(card('N:Сидоров;;;;'))
    expect([p.firstName, p.lastName]).toEqual(['Сидоров', undefined])
  })
  it('пропускает карточки без имени', () => {
    expect(parseVCards(card('TEL:+7 900 000 00 00'))).toHaveLength(0)
  })
  it('разворачивает перенесённые строки (folding)', () => {
    const [p] = parseVCards(card('FN:Иван\r\n  Петров\r\nNOTE:Очень длинная\r\n  заметка'))
    expect(p.firstName).toBe('Иван')
    expect(p.lastName).toBe('Петров')
    expect(p.notes).toBe('Очень длинная заметка')
  })
  it('декодирует quoted-printable в UTF-8', () => {
    const [p] = parseVCards(card('N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D0=9F=D0=B5=D1=82=D1=80=D0=BE=D0=B2;=D0=98=D0=B2=D0=B0=D0=BD;;;'))
    expect([p.firstName, p.lastName]).toEqual(['Иван', 'Петров'])
  })
  it('день рождения без года (--MM-DD и iOS-год 1604)', () => {
    expect(parseVCards(card('FN:А Б\r\nBDAY:--03-08'))[0].birthday).toBe('--03-08')
    expect(parseVCards(card('FN:А Б\r\nBDAY:1604-03-08'))[0].birthday).toBe('--03-08')
    expect(parseVCards(card('FN:А Б\r\nBDAY:19900308'))[0].birthday).toBe('1990-03-08')
  })
  it('понимает item1.-префиксы Apple и Instagram/X', () => {
    const [p] = parseVCards(card('FN:А Б\r\nitem1.URL:https://instagram.com/anna.k/\r\nitem2.URL:https://x.com/anna_k'))
    expect(p.channels).toEqual(expect.arrayContaining([{ type: 'instagram', value: 'anna.k' }, { type: 'x', value: 'anna_k' }]))
  })
  it('фото в base64', () => {
    const b64 = 'A'.repeat(200)
    expect(parseVCards(card(`FN:А Б\r\nPHOTO;ENCODING=b;TYPE=JPEG:${b64}`))[0].photo).toBe(`data:image/jpeg;base64,${b64}`)
  })
  it('мусор вместо vCard — пустой список без исключений', () => {
    expect(parseVCards('')).toEqual([])
    expect(parseVCards('просто текст')).toEqual([])
    expect(parseVCards('BEGIN:VCARD\r\nбез конца')).toBeInstanceOf(Array)
  })
})

describe('toVCard', () => {
  const p = person({
    firstName: 'Анна', lastName: 'Ким', company: 'Acme; Inc', role: 'CTO', city: 'Алматы', birthday: '1990-05-14', notes: 'Строка 1\nСтрока 2, с запятой',
    channels: [{ type: 'phone', value: '+7 700 1' }, { type: 'email', value: 'a@k.im' }, { type: 'telegram', value: '@anna' }, { type: 'instagram', value: '@anna.k' }, { type: 'website', value: 'https://k.im' }],
  })
  const text = toVCard(p)
  it('структура и экранирование', () => {
    expect(text.startsWith('BEGIN:VCARD\r\nVERSION:3.0')).toBe(true)
    expect(text.endsWith('END:VCARD')).toBe(true)
    expect(text).toContain('ORG:Acme\\; Inc')
    expect(text).toContain('NOTE:Строка 1\\nСтрока 2\\, с запятой')
    expect(text).toContain('URL:https://t.me/anna')
    expect(text).toContain('URL:https://instagram.com/anna.k')
  })
  it('экспорт → импорт сохраняет ключевые поля', () => {
    const [back] = parseVCards(text)
    expect(back).toMatchObject({ firstName: 'Анна', lastName: 'Ким', company: 'Acme; Inc', role: 'CTO', city: 'Алматы', birthday: '1990-05-14' })
    expect(back.notes).toBe('Строка 1\nСтрока 2, с запятой')
    expect(back.channels.find(c => c.type === 'phone')?.value).toBe('+7 700 1')
  })
})
