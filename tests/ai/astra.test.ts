import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyPlan, astraAsk, astraBrief, astraCapture, astraDrafts, astraLeadDrafts, astraMatches, astraNews, astraNoteSuggest, astraWeekly, clearAiCache, localIntroDrafts,
  setIntroStatus, testConnection,
} from '@/ai/astra'
import type { CapturePlan } from '@/ai/schemas'
import { activeAi, astraJSON, astraWebText } from '@/ai/client'
import { db } from '@/data/db'
import type { AiSettings } from '@/data/types'
import { DAY } from '@/lib/format'
import { NOW, interaction, lead, person, reminder, resetDb } from '../helpers'

vi.mock('@/ai/client', async orig => ({
  ...(await orig<typeof import('@/ai/client')>()),
  activeAi: vi.fn(),
  astraJSON: vi.fn(),
  astraWebText: vi.fn(),
}))

const AI: AiSettings = { mode: 'key', apiKey: 'k', model: 'claude-opus-5-5', shareNotes: false, webSearch: true, consentAt: 1 }
const cloud = (on = true) => vi.mocked(activeAi).mockResolvedValue(on ? AI : null)
const json = vi.mocked(astraJSON)

const planWith = (patch: Partial<CapturePlan['people'][number]> = {}, extra: Partial<CapturePlan> = {}): CapturePlan => ({
  summary: 's',
  people: [{
    ref: 'p1', existing_id: null, first_name: 'Артём', last_name: 'Белов', role: 'CTO', company: 'Acme', city: 'Дубай', family: null, facts: ['Любит бег'], interests: ['AI'],
    looking_for: 'Инвестор', can_help: 'Rust', i_can_help: 'Интро', channels: [{ type: 'telegram', value: 'artem' }], birthday: '--05-14', met_place: 'Web Summit', introduced_by_id: null,
    topics: ['Как переезд'], gift_ideas: 'Книги', ...patch,
  }],
  interaction: { type: 'meeting', title: 'Кофе', summary: 'Обсудили', place: 'Кафе', person_refs: ['p1'] },
  reminders: [{ person_ref: 'p1', text: 'Созвониться', due_date: '2026-10-09' }],
  ...extra,
})

beforeEach(async () => {
  await resetDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  json.mockReset()
  vi.mocked(astraWebText).mockReset()
  cloud(false)
})

describe('без модели (базовый режим)', () => {
  it('capture / ask / brief / drafts / matches / weekly работают локально и помечены source=local', async () => {
    await db.people.bulkPut([person({ id: 'a', firstName: 'Алина', lookingFor: 'CTO', lastContactAt: NOW - 100 * DAY, closeness: 1 }), person({ id: 'b', firstName: 'Даниил', role: 'CTO', lastContactAt: NOW - DAY })])
    expect((await astraCapture('Познакомился с Артёмом', [])).source).toBe('local')
    expect((await astraAsk('кому давно не писал')).source).toBe('local')
    expect((await astraBrief('a')).source).toBe('local')
    expect((await astraDrafts('a', null)).source).toBe('local')
    expect((await astraMatches()).source).toBe('local')
    expect((await astraWeekly()).source).toBe('local')
    expect(json).not.toHaveBeenCalled()
  })
  it('brief и drafts для несуществующего человека — ошибка, а не пустота', async () => {
    await expect(astraBrief('нет')).rejects.toThrow(/не найден/)
    await expect(astraDrafts('нет', null)).rejects.toThrow(/не найден/)
    await expect(astraLeadDrafts('нет')).rejects.toThrow(/не найден/)
  })
  it('предложения из заметки для несуществующего человека — пусто', async () => {
    expect(await astraNoteSuggest('что-то', 'нет')).toEqual({ data: { items: [] }, source: 'local' })
  })
  it('новости только с моделью и разрешением на веб-поиск', async () => {
    await db.people.put(person({ id: 'a', firstName: 'Нина', company: 'Acme' }))
    expect(await astraNews('a')).toBeNull()
    expect(astraWebText).not.toHaveBeenCalled()
  })
  it('testConnection без подключения', async () => {
    expect(await testConnection()).toEqual({ ok: false, message: 'Астра не подключена' })
  })
})

describe('с моделью: ответы чистятся и резервируются локальным режимом', () => {
  beforeEach(() => cloud())

  it('capture: чужие id заменяются на null, неверные даты напоминаний отбрасываются', async () => {
    await db.people.put(person({ id: 'real', firstName: 'Реальный' }))
    json.mockResolvedValue(planWith({ existing_id: 'выдуманный', introduced_by_id: 'real' }, { reminders: [{ person_ref: 'p1', text: 'ок', due_date: '2026-10-09' }, { person_ref: 'p1', text: 'плохая дата', due_date: 'завтра' }] }))
    const r = await astraCapture('любой текст', [])
    expect(r.source).toBe('ai')
    expect(r.data.people[0].existing_id).toBeNull()
    expect(r.data.people[0].introduced_by_id).toBe('real')
    expect(r.data.reminders.map(x => x.text)).toEqual(['ок'])
  })
  it('capture: фото отправляются как изображения, текст — с сегодняшней датой', async () => {
    json.mockResolvedValue(planWith())
    await astraCapture('', ['data:image/jpeg;base64,AAAA'])
    const call = json.mock.calls[0][1]
    expect(call.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'text', text: expect.stringContaining('2026-10-05') },
    ])
    expect(JSON.stringify(call.content)).toContain('только фото')
  })
  it('capture: ошибка модели → локальный разбор и понятное сообщение', async () => {
    json.mockRejectedValue(Object.assign(new Error('x'), { status: 429 }))
    const r = await astraCapture('Познакомился с Артёмом Беловым', [])
    expect(r.source).toBe('local')
    expect(r.error).toMatch(/Слишком много запросов/)
    expect(r.data.people[0].first_name).toBe('Артём')
  })
  it('ask: неизвестные id отфильтрованы', async () => {
    await db.people.put(person({ id: 'a', firstName: 'Анна' }))
    json.mockResolvedValue({ answer: 'вот', people: [{ id: 'a', reason: 'да' }, { id: 'ghost', reason: 'нет' }], follow_ups: [] })
    const r = await astraAsk('кто?')
    expect(r.data.people.map(p => p.id)).toEqual(['a'])
    expect(r.source).toBe('ai')
  })
  it('ask: в контекст уходит индекс сети без контактов', async () => {
    await db.people.put(person({ id: 'a', firstName: 'Анна', channels: [{ type: 'phone', value: '+7 999 000 00 00' }] }))
    json.mockResolvedValue({ answer: '', people: [], follow_ups: [] })
    await astraAsk('кто?')
    const call = json.mock.calls[0][1]
    expect(call.context).toContain('id:a')
    expect(call.context).not.toContain('+7 999')
  })
  it('brief кешируется; force обходит кеш; после изменений человека кеш обновляется', async () => {
    await db.people.put(person({ id: 'a', firstName: 'Нина', updatedAt: 1 }))
    const brief = { headline: 'h', who: 'w', last_time: 'l', promises_mine: [], promises_theirs: [], ask_about: [], details: [], you_can_help: [], careful: [], opener: 'o' }
    json.mockResolvedValue(brief)
    await astraBrief('a')
    await astraBrief('a')
    expect(json).toHaveBeenCalledTimes(1)
    await astraBrief('a', true)
    expect(json).toHaveBeenCalledTimes(2)
    await db.people.update('a', { updatedAt: 2 })
    await astraBrief('a')
    expect(json).toHaveBeenCalledTimes(3)
  })
  it('clearAiCache по префиксу', async () => {
    await db.aiCache.bulkPut([{ key: 'brief:1', at: 1, value: 1 }, { key: 'brief:2', at: 1, value: 1 }, { key: 'drafts:1', at: 1, value: 1 }])
    await clearAiCache('brief:')
    expect((await db.aiCache.toArray()).map(x => x.key)).toEqual(['drafts:1'])
  })
  it('drafts: отправителя и повод передаёт, при ошибке — локальные черновики', async () => {
    await db.people.put(person({ id: 'a', firstName: 'Нина' }))
    await db.settings.put({ id: 'me', name: 'Макс Зайцев', onboarded: true, createdAt: 1 })
    json.mockRejectedValue(new Error('Connection error.'))
    const r = await astraDrafts('a', null)
    expect(r.source).toBe('local')
    expect(r.error).toMatch(/базовом режиме/)
    expect(r.data.warm).toContain('Нина')
  })
  it('matches: выдуманные люди и самопары отбрасываются, дубли пар (A×B и B×A) схлопываются', async () => {
    await db.people.bulkPut([person({ id: 'a', firstName: 'А' }), person({ id: 'b', firstName: 'Б' })])
    json.mockResolvedValue({ matches: [
      { a_id: 'a', b_id: 'b', reason: 'r1', value: 'v', score: 90 },
      { a_id: 'b', b_id: 'a', reason: 'дубль', value: 'v', score: 80 },
      { a_id: 'a', b_id: 'a', reason: 'сам с собой', value: 'v', score: 70 },
      { a_id: 'a', b_id: 'ghost', reason: 'призрак', value: 'v', score: 60 },
    ] })
    const r = await astraMatches()
    expect(r.source).toBe('ai')
    expect(r.data).toHaveLength(1)
    expect(r.data[0].reason).toBe('r1')
  })
  it('matches: отклонённые пары не возвращаются; если ничего не осталось — локальный результат', async () => {
    await db.people.bulkPut([person({ id: 'a', firstName: 'А' }), person({ id: 'b', firstName: 'Б' })])
    await db.intros.put({ id: 'i', aId: 'a', bId: 'b', reason: '', status: 'dismissed', createdAt: 1, updatedAt: 1 })
    json.mockResolvedValue({ matches: [{ a_id: 'b', b_id: 'a', reason: 'r', value: 'v', score: 1 }] })
    const r = await astraMatches()
    expect(r.source).toBe('local')
  })
  it('weekly: приоритеты только по существующим людям; ошибка модели не ломает экран', async () => {
    await db.people.put(person({ id: 'a', firstName: 'Анна', closeness: 1, lastContactAt: NOW - 100 * DAY }))
    json.mockResolvedValue({ headline: 'Заголовок ИИ', narrative: 'Текст ИИ', priorities: [{ person_id: 'a', action: 'Написать', why: 'давно' }, { person_id: 'ghost', action: 'x', why: 'y' }] })
    const w = await astraWeekly(true)
    expect(w.source).toBe('ai')
    expect(w.headline).toBe('Заголовок ИИ')
    expect(w.priorities).toEqual([{ personId: 'a', action: 'Написать', why: 'давно' }])
    json.mockRejectedValue(new Error('boom'))
    expect((await astraWeekly(true)).source).toBe('local')
  })
  it('news: «НЕТ» и пустота — null, свежая новость — текст; без компании не ищет', async () => {
    await db.people.bulkPut([person({ id: 'a', firstName: 'Нина', company: 'Acme' }), person({ id: 'b', firstName: 'Без компании' })])
    vi.mocked(astraWebText).mockResolvedValueOnce('НЕТ')
    expect(await astraNews('a')).toBeNull()
    await clearAiCache('news:')
    vi.mocked(astraWebText).mockResolvedValueOnce('Acme закрыла раунд')
    expect(await astraNews('a')).toBe('Acme закрыла раунд')
    expect(await astraNews('b')).toBeNull()
  })
  it('news: ошибка поиска не ломает черновик', async () => {
    await db.people.put(person({ id: 'a', firstName: 'Нина', company: 'Acme' }))
    vi.mocked(astraWebText).mockRejectedValue(new Error('x'))
    expect(await astraNews('a')).toBeNull()
  })
  it('lead drafts: в модель уходит карточка, но не заметки без разрешения', async () => {
    await db.leads.put(lead({ id: 'l', firstName: 'Давид', why: 'Инвестор', notes: 'СЕКРЕТНАЯ ЗАМЕТКА' }))
    json.mockResolvedValue({ short: 'a', warm: 'b', business: 'c' })
    await astraLeadDrafts('l')
    const content = String(json.mock.calls[0][1].content)
    expect(content).toContain('Давид')
    expect(content).toContain('Инвестор')
    expect(content).not.toContain('СЕКРЕТНАЯ ЗАМЕТКА')
  })
  it('testConnection: успех и ошибка', async () => {
    json.mockResolvedValueOnce({ ok: true, greeting: 'Привет!' })
    expect(await testConnection()).toEqual({ ok: true, message: 'Привет!' })
    json.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }))
    expect((await testConnection()).ok).toBe(false)
  })
})

describe('applyPlan — применение разобранной заметки к базе', () => {
  it('создаёт человека, запись общения и напоминания', async () => {
    const res = await applyPlan(planWith(), { closeness: 2, circleIds: ['c1'], metAt: '2026-10-04' })
    expect(res).toMatchObject({ created: 1, updated: 0 })
    const [p] = await db.people.toArray()
    expect(p).toMatchObject({
      firstName: 'Артём', lastName: 'Белов', role: 'CTO', company: 'Acme', city: 'Дубай', closeness: 2, circleIds: ['c1'], metAt: '2026-10-04', metPlace: 'Web Summit',
      lookingFor: 'Инвестор', canHelpMe: 'Rust', iCanHelp: 'Интро', birthday: '--05-14', giftIdeas: 'Книги',
    })
    expect(p.tags).toEqual(['AI'])
    expect(p.topics.map(t => t.text)).toEqual(['Как переезд'])
    expect(p.facts).toEqual([{ icon: 'sparkle', text: 'Любит бег' }])
    expect(p.lastContactAt).toBe(NOW)
    const [it] = await db.interactions.toArray()
    expect(it).toMatchObject({ personIds: [p.id], type: 'meeting', title: 'Кофе', place: 'Кафе' })
    const [r] = await db.reminders.toArray()
    expect(r).toMatchObject({ personId: p.id, text: 'Созвониться' })
    expect(new Date(r.dueAt).getHours()).toBe(10)
    expect(new Date(r.dueAt).getDate()).toBe(9)
  })
  it('существующего дополняет, не затирая заполненное; списки объединяет без дублей', async () => {
    await db.people.put(person({
      id: 'x', firstName: 'Артём', role: 'Основатель', company: 'Старая', family: 'Жена Маша', tags: ['AI', 'Бег'], facts: [{ icon: 'heart', text: 'любит бег' }],
      channels: [{ type: 'telegram', value: 'artem' }], topics: [{ id: 't', text: 'Как переезд', done: false }], canHelpMe: 'Python',
    }))
    const res = await applyPlan(planWith({ existing_id: 'x', family: 'сын Лёва', can_help: 'Rust' }))
    expect(res).toMatchObject({ created: 0, updated: 1 })
    const p = await db.people.get('x')
    expect(p).toMatchObject({ role: 'Основатель', company: 'Старая', city: 'Дубай' })
    expect(p?.tags).toEqual(['AI', 'Бег'])
    expect(p?.facts).toHaveLength(1) // «Любит бег» — дубль «любит бег» без учёта регистра
    expect(p?.channels).toHaveLength(1)
    expect(p?.topics).toHaveLength(1)
    expect(p?.family).toBe('Жена Маша; сын Лёва')
    expect(p?.canHelpMe).toBe('Python; Rust')
  })
  it('фото прикрепляется по ref; без людей запись общения не создаётся', async () => {
    await applyPlan(planWith(), { photos: { p1: 'data:image/jpeg;base64,xx' } })
    expect((await db.people.toArray())[0].photo).toBe('data:image/jpeg;base64,xx')
    await resetDb()
    await applyPlan(planWith({}, { interaction: { type: 'note', title: 't', summary: 's', place: null, person_refs: ['нет'] } }))
    expect(await db.interactions.count()).toBe(0)
  })
  it('пустое имя заменяется на «Без имени»', async () => {
    await applyPlan(planWith({ first_name: '  ' }))
    expect((await db.people.toArray())[0].firstName).toBe('Без имени')
  })
  it('несколько людей: запись общения привязана ко всем', async () => {
    const plan = planWith()
    plan.people.push({ ...plan.people[0], ref: 'p2', first_name: 'Борис', last_name: null })
    plan.interaction = { type: 'event', title: 'Ужин', summary: 's', place: null, person_refs: ['p1', 'p2'] }
    await applyPlan(plan)
    const [it] = await db.interactions.toArray()
    expect(it.personIds).toHaveLength(2)
    expect(await db.people.count()).toBe(2)
  })
})

describe('знакомства: setIntroStatus и черновики', () => {
  const a = person({ id: 'a', firstName: 'Хасан', lookingFor: 'Инвестор', links: [] })
  const b = person({ id: 'b', firstName: 'Давид', role: 'Партнёр', canHelpMe: 'Инвестирует в fintech' })
  beforeEach(async () => { await db.people.bulkPut([a, b]) })

  it('asked → запись создаётся, повторный вызов обновляет её, а не плодит дубли', async () => {
    await setIntroStatus({ a, b, reason: 'r' }, 'asked')
    await setIntroStatus({ a, b, reason: 'r' }, 'dismissed')
    const all = await db.intros.toArray()
    expect(all).toHaveLength(1)
    expect(all[0].status).toBe('dismissed')
  })
  it('done → взаимные связи и одна запись «моя помощь» на обоих, без повторов при втором нажатии', async () => {
    await setIntroStatus({ a, b, reason: 'нужен инвестор' }, 'done')
    await setIntroStatus({ a, b, reason: 'нужен инвестор' }, 'done')
    expect((await db.people.get('a'))?.links).toEqual([{ personId: 'b', label: 'знакомство через меня' }])
    expect((await db.people.get('b'))?.links).toEqual([{ personId: 'a', label: 'знакомство через меня' }])
    const favors = (await db.interactions.toArray()).filter(i => i.type === 'favor_given')
    expect(favors).toHaveLength(1) // повторное нажатие не плодит записи «я помог»
    expect(favors[0].personIds.sort()).toEqual(['a', 'b'])
  })
  it('localIntroDrafts: без родовых окончаний, с названием задачи в кавычках', () => {
    const d = localIntroDrafts({ a, b, reason: 'r', value: 'v', score: 1 })
    expect(d.to_a).toContain('«инвестор»')
    expect(d.to_a).toContain('Давид')
    expect(d.group).toContain('Знакомьтесь!')
    for (const t of Object.values(d)) expect(t).not.toMatch(/undefined|\(а\)/)
  })
})

describe('мелочи', () => {
  it('интерфейс не зависит от лишних данных: reminder и interaction хелперы корректны', () => {
    expect(reminder().done).toBe(false)
    expect(interaction({ personIds: ['x'] }).type).toBe('message')
  })
})
