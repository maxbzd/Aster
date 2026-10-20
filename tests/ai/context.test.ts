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

describe('networkIndex — что уходит в модель', () => {
  const idx = networkIndex([secret, other], [{ id: 'c1', name: 'Работа', emoji: '💼', palette: 'ocean', order: 0 }], NOW)
  it('нужное для сопоставления: роль, город, интересы, запрос, круг', () => {
    expect(idx).toContain('id:p1 | Анна Ким | CTO @ Acme | Алматы | Работа')
    expect(idx).toContain('интересы: ai')
    expect(idx).toContain('ищет: Инвестор')
    expect(idx).toContain('силён в: Rust')
    expect(idx).toContain('10 дн. без контакта')
  })
  it('приватное не уходит: телефоны, почты, ники, заметки, семья, подарки', () => {
    for (const leak of ['+7 700', 'secret@mail.io', 'anna_secret', 'ЛИЧНАЯ ЗАМЕТКА', 'Муж Олег', 'Книги']) expect(idx).not.toContain(leak)
  })
  it('порядок стабилен (по id) — важно для кеша промптов', () => {
    const a = networkIndex([secret, other], [], NOW)
    const b = networkIndex([other, secret], [], NOW)
    expect(a).toBe(b)
    expect(a.indexOf('id:p0')).toBeLessThan(a.indexOf('id:p1'))
  })
  it('архивных нет, счётчик верный', () => {
    const r = networkIndex([secret, { ...other, archived: true }], [], NOW)
    expect(r).toContain('(1 чел.)')
    expect(r).not.toContain('Борис')
  })
})

describe('namesIndex', () => {
  it('только имена, роли и город для сопоставления', () => {
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
  it('с shareNotes — заметки и история попадают в досье', () => {
    const d = dossier(secret, ints, rems, byId, true, NOW)
    expect(d).toContain('ЛИЧНАЯ ЗАМЕТКА')
    expect(d).toContain('Отправить интро')
    expect(d).toContain('Встреча: Кофе')
  })
  it('без shareNotes — личные заметки не отправляются', () => {
    const d = dossier(secret, ints, rems, byId, false, NOW)
    expect(d).not.toContain('ЛИЧНАЯ ЗАМЕТКА')
    expect(d).not.toContain('ПРИВАТНОЕ РАЗМЫШЛЕНИЕ')
  })
  it('контактные данные не попадают в досье никогда', () => {
    const d = dossier(secret, ints, rems, byId, true, NOW)
    for (const leak of ['+7 700', 'secret@mail.io', 'anna_secret']) expect(d).not.toContain(leak)
  })
})

it('todayLine даёт дату в ISO, чтобы модель считала сроки', () => {
  expect(todayLine(NOW)).toBe('Сегодня: понедельник, 5 октября 2026 (2026-10-05).')
})
