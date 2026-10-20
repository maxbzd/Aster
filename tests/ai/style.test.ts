import { describe, expect, it } from 'vitest'
import { localDrafts } from '@/ai/local/drafts'
import { computeOccasions, OCCASION_META, type Occasion, type OccasionKind } from '@/ai/local/occasions'
import { formalize } from '@/ai/local/style'
import { interaction, NOW, person } from '../helpers'

const occ = (kind: OccasionKind, data: Record<string, string> = {}): Occasion => ({ id: 'x', personId: 'p', kind, title: '', detail: '', priority: 1, data })
const KINDS = Object.keys(OCCASION_META) as OccasionKind[]
const DATA: Record<string, string> = { years: '3', promise: 'Прислать презентацию', favor: 'интро', need: 'CTO', helperId: 'h', topic: 'Переезд', news: 'Новая роль', member: 'Ева', relation: 'ребёнок', days: '2', label: 'Годовщина свадьбы' }

describe('«вы» вместо «ты»', () => {
  it('замены с сохранением регистра', () => {
    expect(formalize('Привет! Как ты? Давай созвонимся, расскажи о себе.')).toBe('Здравствуйте! Как вы? Давайте созвонимся, расскажите о себе.')
    expect(formalize('Помню твой запрос и тебе напишу, у тебя всё получится')).toBe('Помню ваш запрос и вам напишу, у вас всё получится')
  })
  it('приветствие после имени переставляется', () => {
    expect(formalize('Алина, привет! Как дела?')).toBe('Здравствуйте, Алина! Как дела?')
  })
  it('во ВСЕХ черновиках для «вы» не остаётся «ты», «тебе», «твой», «привет»', () => {
    const p = person({ id: 'p', firstName: 'Алина', company: 'Lumen', metPlace: 'Web Summit', topics: [{ id: '1', text: 'Как прошёл раунд', done: false }], prefs: { address: 'vy' } })
    const helper = person({ id: 'h', firstName: 'Борис' })
    for (const kind of [...KINDS, null] as const) {
      const d = localDrafts(p, kind ? occ(kind, DATA) : null, 'Макс', [p, helper])
      for (const text of [d.short, d.warm, d.business]) {
        expect(text, `${kind}: ${text}`).not.toMatch(/(?<![а-яё])(ты|тебе|тебя|твой|твоя|твоё|твою|твои|привет|давай|скажи|расскажи|обнимаю)(?![а-яё])/i)
      }
    }
  })
  it('без отметки остаются на «ты»', () => {
    const p = person({ id: 'p', firstName: 'Алина' })
    expect(localDrafts(p, null, 'Макс', [p]).short).toMatch(/привет/i)
  })
})

describe('язык общения', () => {
  it('английский для основных поводов; русский текст не просачивается', () => {
    const p = person({ id: 'p', firstName: 'Anna', company: 'Acme', prefs: { language: 'en' } })
    for (const kind of [...KINDS, null] as const) {
      const d = localDrafts(p, kind ? occ(kind, { ...DATA, member: 'Eva', label: 'wedding anniversary', promise: 'send the deck', favor: 'the intro', need: 'a CTO for an AI project', topic: 'the move', news: 'a new round' }) : null, 'Max', [p])
      for (const text of [d.short, d.warm, d.business]) {
        expect(text).toMatch(/[A-Za-z]/)
        expect(text, `${kind}`).not.toMatch(/[А-Яа-я]/)
      }
    }
  })
})

describe('семья и важные даты в поводах написать', () => {
  const owner = person({ id: 'o', firstName: 'Алина', lastName: 'Воронцова', createdAt: NOW - 800 * 86_400_000 })
  const kid = person({ id: 'k', firstName: 'Ева', familyOf: 'o', relation: 'child', birthday: '2021-10-07', giftIdeas: 'Конструктор' })

  it('день рождения члена семьи — повод написать владельцу', () => {
    const list = computeOccasions([owner, kid], [], [], [], NOW)
    const f = list.find(o => o.kind === 'family')!
    expect(f).toMatchObject({ personId: 'o', title: 'Ева: день рождения послезавтра', data: { member: 'Ева', turning: '5' } })
    expect(f.detail).toBe('ребёнок Алины · исполнится 5 · идея подарка: Конструктор')
  })

  it('важные даты человека: в окно напоминания попадают, за окном — нет', () => {
    const p = person({ id: 'p', firstName: 'Борис', importantDates: [
      { id: '1', kind: 'anniversary', label: 'Годовщина свадьбы', date: '2016-10-07' },
      { id: '2', kind: 'nameday', label: 'Именины', date: '--10-20' },
      { id: '3', kind: 'event', label: 'Раннее напоминание', date: '2026-10-25', yearly: false, remindDays: 30 },
    ] })
    const titles = computeOccasions([p], [], [], [], NOW).filter(o => o.kind === 'date').map(o => o.title)
    expect(titles).toEqual(expect.arrayContaining(['Годовщина свадьбы послезавтра', 'Раннее напоминание через 20 дней']))
    expect(titles).toHaveLength(2)
    expect(computeOccasions([p], [], [], [], NOW).find(o => o.title.startsWith('Годовщина'))?.detail).toBe('10 лет')
  })

  it('«больше не актуален» и семья архивного владельца не напоминают; обычные поводы у семьи не создаются', () => {
    const gone = person({ id: 'g', firstName: 'Г', birthday: '1990-10-07', lifeStatus: 'irrelevant' })
    const archOwner = person({ id: 'ao', firstName: 'А', archived: true })
    const kid2 = person({ id: 'k2', firstName: 'К', familyOf: 'ao', relation: 'child', birthday: '2020-10-07' })
    expect(computeOccasions([gone, archOwner, kid2], [], [], [], NOW)).toEqual([])
    const silent = computeOccasions([owner, kid], [interaction({ personIds: ['k'], date: NOW - 400 * 86_400_000 })], [], [], NOW)
    expect(silent.filter(o => o.personId === 'k')).toEqual([])
  })

  it('черновик о семье называет члена семьи', () => {
    const o = computeOccasions([owner, kid], [], [], [], NOW).find(x => x.kind === 'family')!
    const d = localDrafts(owner, o, 'Макс', [owner, kid])
    expect(d.warm).toContain('Ева')
  })
})
