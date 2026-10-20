import { describe, expect, it } from 'vitest'
import { dossier, namesIndex, networkIndex, todayLine } from '@/ai/context'
import { DAY } from '@/lib/format'
import { NOW, contactedAgo, interaction, person, reminder } from '../helpers'

const secret = person({
  id: 'p1', firstName: 'Анна', lastName: 'Ким', role: 'CTO', company: 'Acme', city: 'Алматы', tags: ['ai'], lookingFor: 'Инвестор', canHelpMe: 'Rust',
  channels: [{ type: 'phone', value: '+7 700 123 45 67' }, { type: 'email', value: 'secret@mail.io' }, { type: 'telegram', value: 'anna_secret' }],
  notes: 'ЛИЧНАЯ ЗАМЕТКА про развод', family: 'Муж Олег', giftIdeas: 'Книги', circleIds: ['c1'], lastContactAt: NOW - 10 * DAY,
})
const other = contactedAgo(40, { id: 'p0', firstName: 'Борис' })

describe('networkIndex: what goes to the model', () => {
  const idx = networkIndex([secret, other], [{ id: 'c1', name: 'Работа', emoji: '💼', palette: 'ocean', order: 0 }], NOW)
  it('what is needed for matching: role, city, interests, request, circle', () => {
    expect(idx).toContain('id:p1 | Анна Ким | CTO @ Acme | Алматы | Работа')
    expect(idx).toContain('интересы: ai')
    expect(idx).toContain('ищет: Инвестор')
    expect(idx).toContain('силён в: Rust')
    expect(idx).toContain('10 дн. без контакта')
  })
  it('private data does not go: phones, emails, handles, notes, family, gifts', () => {
    for (const leak of ['+7 700', 'secret@mail.io', 'anna_secret', 'ЛИЧНАЯ ЗАМЕТКА', 'Муж Олег', 'Книги']) expect(idx).not.toContain(leak)
  })
  it('the order is stable (by id): important for the prompt cache', () => {
    const a = networkIndex([secret, other], [], NOW)
    const b = networkIndex([other, secret], [], NOW)
    expect(a).toBe(b)
    expect(a.indexOf('id:p0')).toBeLessThan(a.indexOf('id:p1'))
  })
  it('no archived people, the count is right', () => {
    const r = networkIndex([secret, { ...other, archived: true }], [], NOW)
    expect(r).toContain('(1 чел.)')
    expect(r).not.toContain('Борис')
  })
})

describe('namesIndex', () => {
  it('only names, roles and the city for matching', () => {
    const r = namesIndex([secret, person({ id: 'p2', firstName: 'Лёва', nickname: 'Лев' })])
    expect(r).toContain('id:p1 | Анна Ким | CTO @ Acme | Алматы')
    expect(r).toContain('«Лев»')
    expect(r).not.toContain('secret@mail.io')
  })
})

describe('dossier', () => {
  const byId = new Map([[secret.id, secret], [other.id, other]])
  const ints = [
    interaction({ personIds: ['p1'], type: 'meeting', title: 'Кофе', note: 'обсудили раунд', date: NOW - 10 * DAY }),
    interaction({ personIds: ['p1'], type: 'note', title: 'Мысль', note: 'ПРИВАТНОЕ РАЗМЫШЛЕНИЕ', date: NOW - 5 * DAY }),
  ]
  const rems = [reminder({ personId: 'p1', text: 'Отправить интро', dueAt: NOW + 2 * DAY })]
  it('with shareNotes the notes and history get into the dossier', () => {
    const d = dossier(secret, ints, rems, byId, true, NOW)
    expect(d).toContain('ЛИЧНАЯ ЗАМЕТКА')
    expect(d).toContain('Отправить интро')
    expect(d).toContain('Встреча: Кофе')
  })
  it('without shareNotes the personal notes are not sent', () => {
    const d = dossier(secret, ints, rems, byId, false, NOW)
    expect(d).not.toContain('ЛИЧНАЯ ЗАМЕТКА')
    expect(d).not.toContain('ПРИВАТНОЕ РАЗМЫШЛЕНИЕ')
  })
  it('contact details never get into the dossier', () => {
    const d = dossier(secret, ints, rems, byId, true, NOW)
    for (const leak of ['+7 700', 'secret@mail.io', 'anna_secret']) expect(d).not.toContain(leak)
  })
})

it('todayLine gives the date in ISO so that the model can count deadlines', () => {
  expect(todayLine(NOW)).toBe('Сегодня: понедельник, 5 октября 2026 (2026-10-05).')
})
