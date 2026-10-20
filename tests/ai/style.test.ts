import { describe, expect, it } from 'vitest'
import { localDrafts } from '@/ai/local/drafts'
import { computeOccasions, OCCASION_META, type Occasion, type OccasionKind } from '@/ai/local/occasions'
import { formalize } from '@/ai/local/style'
import { interaction, NOW, person } from '../helpers'

const occ = (kind: OccasionKind, data: Record<string, string> = {}): Occasion => ({ id: 'x', personId: 'p', kind, title: '', detail: '', priority: 1, data })
const KINDS = Object.keys(OCCASION_META) as OccasionKind[]
const DATA: Record<string, string> = { years: '3', promise: 'Прислать презентацию', favor: 'интро', need: 'CTO', helperId: 'h', topic: 'Переезд', news: 'Новая роль', member: 'Ева', relation: 'ребёнок', days: '2', label: 'Годовщина свадьбы' }

describe('"вы" instead of "ты" (formal Russian address)', () => {
  it('replacements that keep the case', () => {
    expect(formalize('Привет! Как ты? Давай созвонимся, расскажи о себе.')).toBe('Здравствуйте! Как вы? Давайте созвонимся, расскажите о себе.')
    expect(formalize('Помню твой запрос и тебе напишу, у тебя всё получится')).toBe('Помню ваш запрос и вам напишу, у вас всё получится')
  })
  it('a greeting after the name is moved', () => {
    expect(formalize('Алина, привет! Как дела?')).toBe('Здравствуйте, Алина! Как дела?')
  })
  it('in ALL drafts for the formal register no "ты", "тебе", "твой", "привет" is left', () => {
    const p = person({ id: 'p', firstName: 'Алина', company: 'Lumen', metPlace: 'Web Summit', topics: [{ id: '1', text: 'Как прошёл раунд', done: false }], prefs: { address: 'vy' } })
    const helper = person({ id: 'h', firstName: 'Борис' })
    for (const kind of [...KINDS, null] as const) {
      const d = localDrafts(p, kind ? occ(kind, DATA) : null, 'Макс', [p, helper])
      for (const text of [d.short, d.warm, d.business]) {
        expect(text, `${kind}: ${text}`).not.toMatch(/(?<![а-яё])(ты|тебе|тебя|твой|твоя|твоё|твою|твои|привет|давай|скажи|расскажи|обнимаю)(?![а-яё])/i)
      }
    }
  })
  it('without a mark they stay informal', () => {
    const p = person({ id: 'p', firstName: 'Алина' })
    expect(localDrafts(p, null, 'Макс', [p]).short).toMatch(/привет/i)
  })
})

describe('the language of communication', () => {
  it('English for the main occasions; no Russian text leaks in', () => {
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

describe('family and important dates in the reasons to write', () => {
  const owner = person({ id: 'o', firstName: 'Алина', lastName: 'Воронцова', createdAt: NOW - 800 * 86_400_000 })
  const kid = person({ id: 'k', firstName: 'Ева', familyOf: 'o', relation: 'child', birthday: '2021-10-07', giftIdeas: 'Конструктор' })

  it('a family member\'s birthday is a reason to write to the owner', () => {
    const list = computeOccasions([owner, kid], [], [], [], NOW)
    const f = list.find(o => o.kind === 'family')!
    expect(f).toMatchObject({ personId: 'o', title: 'Ева: день рождения послезавтра', data: { member: 'Ева', turning: '5' } })
    expect(f.detail).toBe('ребёнок Алины · исполнится 5 · идея подарка: Конструктор')
  })

  it('a person\'s important dates: inside the reminder window they appear, outside it they do not', () => {
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

  it('"no longer relevant" and the family of an archived owner do not remind; ordinary reasons are not created for family', () => {
    const gone = person({ id: 'g', firstName: 'Г', birthday: '1990-10-07', lifeStatus: 'irrelevant' })
    const archOwner = person({ id: 'ao', firstName: 'А', archived: true })
    const kid2 = person({ id: 'k2', firstName: 'К', familyOf: 'ao', relation: 'child', birthday: '2020-10-07' })
    expect(computeOccasions([gone, archOwner, kid2], [], [], [], NOW)).toEqual([])
    const silent = computeOccasions([owner, kid], [interaction({ personIds: ['k'], date: NOW - 400 * 86_400_000 })], [], [], NOW)
    expect(silent.filter(o => o.personId === 'k')).toEqual([])
  })

  it('a draft about family names the family member', () => {
    const o = computeOccasions([owner, kid], [], [], [], NOW).find(x => x.kind === 'family')!
    const d = localDrafts(owner, o, 'Макс', [owner, kid])
    expect(d.warm).toContain('Ева')
  })
})
