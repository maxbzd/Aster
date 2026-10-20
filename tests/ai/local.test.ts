import { describe, expect, it } from 'vitest'
import { localAsk } from '@/ai/local/ask'
import { localBrief } from '@/ai/local/brief'
import { localDrafts } from '@/ai/local/drafts'
import { expand, localMatches, pairSub, pairTitle } from '@/ai/local/matches'
import { OCCASION_META, computeOccasions, topOccasionByPerson, type Occasion, type OccasionKind } from '@/ai/local/occasions'
import { localWeekly, weekKey } from '@/ai/local/weekly'
import { DAY, toISODate } from '@/lib/format'
import { NOW, contactedAgo, interaction, person, reminder } from '../helpers'

const investor = person({ id: 'inv', firstName: 'Давид', lastName: 'Шварц', role: 'Партнёр', company: 'Northwind Capital', city: 'Дубай', tags: ['fintech'], canHelpMe: 'Инвестирует в seed fintech в MENA', lastContactAt: NOW - 5 * DAY })
const founder = person({ id: 'fnd', firstName: 'Хасан', lastName: 'Юсупов', role: 'Основатель', company: 'Oasis Pay', city: 'Дубай', lookingFor: 'Инвестор для seed-раунда, fintech MENA', lastContactAt: NOW - 3 * DAY })
const designer = person({ id: 'dsg', firstName: 'Лиза', lastName: 'Мур', role: 'UX-дизайнер', tags: ['ux', 'mobile'], canHelpMe: 'UX и мобильный дизайн', lastContactAt: NOW - 90 * DAY })
const rustam = person({ id: 'rst', firstName: 'Рустам', lastName: 'Галиев', role: 'Продакт', company: 'Pixel', lookingFor: 'UX-дизайнер для мобильного приложения' })

describe('localMatches: the "Matchmaker"', () => {
  const pairs = localMatches([investor, founder, designer, rustam])
  it('links the one who is looking with the one who can do it', () => {
    const titles = pairs.map(pairTitle)
    expect(titles).toContain('Хасан Юсупов × Давид Шварц')
    expect(titles).toContain('Рустам Галиев × Лиза Мур')
  })
  it('a pair has a reason, a benefit and a caption', () => {
    const p = pairs.find(x => x.a.id === 'fnd')
    expect(p?.reason).toMatch(/Хасан ищет «Инвестор для seed-раунда, fintech MENA»/)
    expect(p?.value).toBeTruthy()
    expect(pairSub(p as NonNullable<typeof p>)).toContain('Партнёр · Northwind Capital')
  })
  it('the strongest first, one "seeker" per pair, never oneself', () => {
    const scores = pairs.map(p => p.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(new Set(pairs.map(p => p.a.id)).size).toBe(pairs.length)
    expect(pairs.every(p => p.a.id !== p.b.id)).toBe(true)
  })
  it('does not suggest people who already know each other, colleagues or dismissed pairs', () => {
    expect(localMatches([investor, { ...founder, links: [{ personId: 'inv', label: 'друзья' }] }])).toEqual([])
    expect(localMatches([investor, { ...founder, introducedBy: 'inv' }])).toEqual([])
    expect(localMatches([investor, { ...founder, company: 'northwind capital' }])).toEqual([])
    expect(localMatches([investor, founder], new Set(['fnd:inv']))).toEqual([])
    expect(localMatches([investor, founder], new Set(['inv:fnd']))).toEqual([])
  })
  it('skips archived people', () => {
    expect(localMatches([investor, { ...founder, archived: true }])).toEqual([])
  })
  it('a weak match does not get on the list', () => {
    expect(localMatches([person({ id: 'x', firstName: 'А', lookingFor: 'повар' }), person({ id: 'y', firstName: 'Б', role: 'бухгалтер' })])).toEqual([])
  })
  it('synonyms: "CTO" finds "technical director"', () => {
    const r = localMatches([person({ id: 'a', firstName: 'А', lookingFor: 'Нужен CTO в AI-проект' }), person({ id: 'b', firstName: 'Б', role: 'Технический директор', tags: ['rust'] })])
    expect(r).toHaveLength(1)
  })
  it('expand adds related stems', () => {
    expect(expand(['инвестор'])).toEqual(expect.arrayContaining(['фонд', 'ангел']))
  })
})

describe('localAsk: "Ask the network" without a model', () => {
  const net = [investor, founder, designer, person({ id: 'bd', firstName: 'Ольга', birthday: '--10-12', lastContactAt: NOW - 2 * DAY })]
  it('birthdays: lists the nearest ones', () => {
    const r = localAsk('у кого скоро день рождения', net, [], NOW)
    expect(r.people.map(p => p.id)).toEqual(['bd'])
    expect(r.answer).toMatch(/рожден/i)
  })
  it('no birthdays: an honest answer, not emptiness', () => {
    expect(localAsk('у кого день рождения', [investor], [], NOW).answer).toMatch(/нет/)
  })
  it('"whom haven\'t I written to for a long time": by how overdue the rhythm is, close ones first', () => {
    const r = localAsk('кому давно не писал', [designer, contactedAgo(300, { id: 'close', closeness: 1 }), investor], [], NOW)
    expect(r.people[0].id).toBe('close')
  })
  it('search by city, roles and synonyms: "visa in the UAE" → Dubai', () => {
    const r = localAsk('кто поможет с визой в ОАЭ?', net, [], NOW)
    expect(r.people.map(p => p.id)).toEqual(expect.arrayContaining(['inv', 'fnd']))
    expect(r.people.find(p => p.id === 'inv')?.reason).toMatch(/Дубай/)
  })
  it('search by role', () => {
    expect(localAsk('нужен дизайнер', net, [], NOW).people.map(p => p.id)).toContain('dsg')
  })
  it('nothing found: a hint instead of an empty screen', () => {
    const r = localAsk('кто умеет жонглировать', net, [], NOW)
    expect(r.people).toEqual([])
    expect(r.answer).toMatch(/Прямых совпадений нет/)
  })
  it('an empty question does not crash', () => {
    expect(() => localAsk('', net, [], NOW)).not.toThrow()
  })
  it('does not return archived people', () => {
    expect(localAsk('дизайнер', [{ ...designer, archived: true }], [], NOW).people).toEqual([])
  })
})

describe('computeOccasions: reasons to write', () => {
  const kinds = (list: Occasion[], id: string) => list.filter(o => o.personId === id).map(o => o.kind)
  it('a birthday in the next 7 days, the priority grows as the date nears', () => {
    const tomorrow = person({ id: 'a', birthday: `--${toISODate(NOW + DAY).slice(5)}` })
    const inSix = person({ id: 'b', birthday: `--${toISODate(NOW + 6 * DAY).slice(5)}` })
    const far = person({ id: 'c', birthday: `--${toISODate(NOW + 20 * DAY).slice(5)}` })
    const list = computeOccasions([tomorrow, inSix, far], [], [], [], NOW)
    expect(kinds(list, 'a')).toContain('birthday')
    expect(kinds(list, 'c')).not.toContain('birthday')
    expect(list.find(o => o.personId === 'a')?.priority).toBeGreaterThan(list.find(o => o.personId === 'b')?.priority ?? 0)
  })
  it('the anniversary of meeting: only from a year on and within a ± window', () => {
    const met = new Date(2023, 9, 5)
    const p = person({ id: 'a', metAt: toISODate(met), metPlace: 'Web Summit' })
    expect(computeOccasions([p], [], [], [], NOW).find(o => o.kind === 'anniversary')?.title).toBe('3 года знакомства')
    const fresh = person({ id: 'b', metAt: toISODate(new Date(2026, 9, 5)) })
    expect(kinds(computeOccasions([fresh], [], [], [], NOW), 'b')).not.toContain('anniversary')
  })
  it('a fresh acquaintance with no follow-up, but not after a contact', () => {
    const p = person({ id: 'a', metAt: toISODate(NOW - 2 * DAY) })
    expect(kinds(computeOccasions([p], [], [], [], NOW), 'a')).toContain('new')
    const after = interaction({ personIds: ['a'], type: 'message', date: NOW - DAY })
    expect(kinds(computeOccasions([p], [after], [], [], NOW), 'a')).not.toContain('new')
  })
  it('a promise from reminders, an overdue one matters more', () => {
    const p = person({ id: 'a', lastContactAt: NOW - DAY })
    const soon = computeOccasions([p], [], [reminder({ personId: 'a', text: 'Отправить презентацию', dueAt: NOW + DAY })], [], NOW).find(o => o.kind === 'promise')
    const late = computeOccasions([p], [], [reminder({ personId: 'a', text: 'Отправить презентацию', dueAt: NOW - 3 * DAY })], [], NOW).find(o => o.kind === 'promise')
    expect(soon?.title).toBe('Обещание')
    expect(late?.title).toBe('Обещание просрочено')
    expect(late?.priority).toBeGreaterThan(soon?.priority ?? 0)
  })
  it('completed and ordinary reminders do not count as a reason', () => {
    const p = person({ id: 'a', lastContactAt: NOW - DAY })
    expect(kinds(computeOccasions([p], [], [reminder({ personId: 'a', text: 'Отправить', done: true })], [], NOW), 'a')).not.toContain('promise')
    expect(kinds(computeOccasions([p], [], [reminder({ personId: 'a', text: 'Купить молоко' })], [], NOW), 'a')).not.toContain('promise')
  })
  it('"You were helped": until you reciprocate', () => {
    const p = person({ id: 'a', lastContactAt: NOW - 5 * DAY })
    const got = interaction({ personIds: ['a'], type: 'favor_got', date: NOW - 10 * DAY, title: 'Интро в фонд' })
    expect(kinds(computeOccasions([p], [got], [], [], NOW), 'a')).toContain('favor')
    const back = interaction({ personIds: ['a'], type: 'gift', date: NOW - 5 * DAY })
    expect(kinds(computeOccasions([p], [got, back], [], [], NOW), 'a')).not.toContain('favor')
  })
  it('can help with an introduction: from the "Matchmaker" pairs', () => {
    const matches = localMatches([investor, founder])
    expect(kinds(computeOccasions([investor, founder], [], [], matches, NOW), 'fnd')).toContain('need')
  })
  it('silence: only the inner orbits and only a strong overdue', () => {
    const cold = contactedAgo(100, { id: 'a', closeness: 2 })
    const far = contactedAgo(1000, { id: 'b', closeness: 4 })
    const list = computeOccasions([cold, far], [], [], [], NOW)
    expect(kinds(list, 'a')).toContain('silence')
    expect(kinds(list, 'b')).not.toContain('silence')
  })
  it('an archived person is skipped; sorted by priority; topOccasionByPerson takes the best', () => {
    const p = person({ id: 'a', birthday: `--${toISODate(NOW + DAY).slice(5)}`, lastContactAt: NOW - 100 * DAY, closeness: 1, topics: [{ id: 't', text: 'Как переезд', done: false }] })
    const list = computeOccasions([p, person({ id: 'z', archived: true, birthday: `--${toISODate(NOW).slice(5)}` })], [], [], [], NOW)
    expect(list.every(o => o.personId !== 'z')).toBe(true)
    const prios = list.map(o => o.priority)
    expect(prios).toEqual([...prios].sort((a, b) => b - a))
    expect(topOccasionByPerson(list).get('a')?.kind).toBe('birthday')
  })
  it('New Year: only in season and only for the close orbits', () => {
    const dec = new Date(2026, 11, 28).getTime()
    expect(kinds(computeOccasions([person({ id: 'a', closeness: 2 })], [], [], [], dec), 'a')).toContain('holiday')
    expect(kinds(computeOccasions([person({ id: 'a', closeness: 4 })], [], [], [], dec), 'a')).not.toContain('holiday')
    expect(kinds(computeOccasions([person({ id: 'a', closeness: 2 })], [], [], [], NOW), 'a')).not.toContain('holiday')
  })
  it('every kind of occasion has its presentation', () => {
    for (const k of Object.keys(OCCASION_META) as OccasionKind[]) expect(OCCASION_META[k].label).toBeTruthy()
  })
})

describe('localDrafts: message drafts', () => {
  const p = person({ id: 'a', firstName: 'Нина', company: 'Acme', metPlace: 'Web Summit', iCanHelp: 'интро к инвесторам', topics: [{ id: 't', text: 'Как адаптация в Португалии', done: false }] })
  const mk = (kind: OccasionKind, data: Record<string, string> = {}): Occasion => ({ id: `${kind}-a`, personId: 'a', kind, title: 't', detail: 'd', priority: 1, data })
  const occasions: [string, Occasion | null][] = [
    ['без повода', null],
    ['birthday', mk('birthday', { days: '0' })],
    ['anniversary', mk('anniversary', { years: '3' })],
    ['new', mk('new')],
    ['promise', mk('promise', { promise: 'Отправить апдейт по метрикам' })],
    ['favor', mk('favor', { favor: 'Интро в фонд' })],
    ['need', mk('need', { need: 'CTO в AI-проект', helperId: 'inv' })],
    ['topic', mk('topic', { topic: 'Как адаптация в Португалии' })],
    ['silence', mk('silence')],
    ['holiday', mk('holiday')],
    ['news', mk('news', { news: 'Компания закрыла раунд' })],
  ]
  it.each(occasions)('%s: three different tones, no junk and no gendered endings', (_, o) => {
    const d = localDrafts(p, o, 'Макс', [investor], interaction({ personIds: ['a'], title: 'Кофе' }))
    const texts = [d.short, d.warm, d.business]
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(10)
      expect(t).toContain('Нина')
      expect(t).not.toMatch(/undefined|null|NaN|\[object|\(а\)|\(ла\)/)
      expect(t).not.toMatch(/ {2,}/)
    }
    expect(new Set(texts).size).toBe(3)
  })
  it('the "can help" occasion names a suitable person', () => {
    const d = localDrafts(p, mk('need', { need: 'CTO в AI-проект', helperId: 'inv' }), 'Макс', [investor])
    expect(d.warm).toContain('Давид Шварц')
    expect(d.warm).toContain('«cTO'.replace('cTO', 'CTO в AI-проект'))
  })
  it('abbreviations in the middle of a phrase keep their case', () => {
    const d = localDrafts(p, mk('need', { need: 'CTO в AI-проект', helperId: 'inv' }), 'Макс', [investor])
    expect(`${d.short}${d.warm}${d.business}`).not.toMatch(/cTO|aI-/)
  })
})

describe('localBrief', () => {
  const p = person({
    id: 'a', firstName: 'Нина', lastName: 'Чернова', role: 'Психотерапевт', closeness: 1, metAt: '2024-01-10', lastContactAt: NOW - 20 * DAY, birthday: `--${toISODate(NOW + 5 * DAY).slice(5)}`,
    family: 'Партнёр Жоау, сын Лёва', lookingFor: 'Группа для супервизий', iCanHelp: 'интро к коллегам', topics: [{ id: 't', text: 'Как адаптация', done: false }, { id: 't2', text: 'Закрытая', done: true }],
    facts: [{ icon: 'heart', text: 'Учится сёрфингу' }],
  })
  const ints = [interaction({ personIds: ['a'], type: 'meeting', date: NOW - 20 * DAY, title: 'Кофе', note: 'Обсуждали переезд и запуск практики' })]
  const b = localBrief(p, ints, [reminder({ personId: 'a', text: 'Отправить ссылку', dueAt: NOW + DAY })], new Map([[p.id, p]]), [], NOW)
  it('the title: orbit, how long you have known each other, how long ago', () => {
    expect(b.headline).toMatch(/Нина — ближний круг, знакомы 2 года/)
  })
  it('questions: open topics and a request, closed ones are not included', () => {
    expect(b.ask_about).toEqual(expect.arrayContaining(['Как адаптация?']))
    expect(b.ask_about.join(' ')).not.toMatch(/Закрытая/)
    expect(b.ask_about.join(' ')).toMatch(/группа для супервизий/i)
    expect(b.ask_about.join(' ')).toMatch(/Что с тем, о чём говорили/)
  })
  it('details: family, facts, the nearest birthday; help: "how I can help"', () => {
    expect(b.details).toEqual(expect.arrayContaining(['Партнёр Жоау, сын Лёва', 'Учится сёрфингу']))
    expect(b.details.join(' ')).toMatch(/День рождения/)
    expect(b.you_can_help).toContain('интро к коллегам')
  })
  it('there is a phrase to open the conversation and no "undefined"', () => {
    expect(b.opener.length).toBeGreaterThan(5)
    expect(JSON.stringify(b)).not.toMatch(/undefined|null|NaN/)
  })
  it('with no data it does not crash and stays meaningful', () => {
    const empty = person({ id: 'e', firstName: 'Пустой' })
    const e = localBrief(empty, [], [], new Map(), [], NOW)
    expect(e.headline).toContain('Пустой')
    expect(JSON.stringify(e)).not.toMatch(/undefined|NaN/)
  })
})

describe('localWeekly: the weekly brief', () => {
  it('weekKey is the Monday of the week', () => {
    expect(weekKey(NOW)).toBe('2026-10-05')
    expect(weekKey(new Date(2026, 9, 11, 23, 59).getTime())).toBe('2026-10-05')
    expect(weekKey(new Date(2026, 9, 12).getTime())).toBe('2026-10-12')
  })
  const people = [
    contactedAgo(100, { id: 'c1', firstName: 'Пётр', closeness: 1 }),
    person({ id: 'b1', firstName: 'Тимур', birthday: `--${toISODate(NOW + 2 * DAY).slice(5)}`, lastContactAt: NOW - DAY }),
    person({ id: 'n1', firstName: 'Новичок', createdAt: NOW - 2 * DAY, lastContactAt: NOW - DAY }),
  ]
  const w = localWeekly(people, [interaction({ personIds: ['b1'], type: 'call', date: NOW - DAY })], [reminder({ personId: 'b1', dueAt: NOW + 2 * DAY })], new Map(), [], NOW)
  it('the week\'s range and statistics', () => {
    expect(w.range).toBe('5 окт — 11 окт')
    expect(w.stats).toMatchObject({ contacts: 1, newPeople: 1 })
  })
  it('priorities: a birthday first, then cooling close ones', () => {
    expect(w.priorities[0]).toMatchObject({ personId: 'b1', action: 'Поздравить с днём рождения' })
    expect(w.priorities.map(p => p.personId)).toContain('c1')
  })
  it('in the text it counts "cooling" and "new acquaintances" by the same rule as the main screen', () => {
    expect(w.narrative).toMatch(/1 день рождения/)
    expect(w.narrative).toMatch(/1 близкая связь остывает/)
  })
  it('a calm week with an empty network', () => {
    const empty = localWeekly([], [], [], new Map(), [], NOW)
    expect(empty.narrative).toMatch(/ничего срочного/)
    expect(empty.priorities).toEqual([])
  })
})
