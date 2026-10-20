import { describe, expect, it } from 'vitest'
import { askReserve, expandNeed, filterLeads, leadLine, localLeadDrafts, reserveMatches, scoreLead } from '@/ai/local/reserve'
import { lead, person } from '../helpers'

const david = lead({ id: 'david', firstName: 'Давид', lastName: 'Шварц', role: 'Управляющий партнёр', company: 'Northwind Capital', city: 'Дубай', why: 'Инвестирует в seed fintech в MENA', source: 'Web Summit', tags: ['Инвестор', 'Fintech'], star: true })
const arman = lead({ id: 'arman', firstName: 'Арман', lastName: 'Касымов', role: 'Юрист по релокации', city: 'Дубай', why: 'Виза и ВНЖ в ОАЭ, открытие компаний', tags: ['Юрист'] })
const milana = lead({ id: 'milana', firstName: 'Милана', lastName: 'Орлова', role: 'Lead Product Designer', why: 'UX мобильных приложений', tags: ['Дизайн'], city: 'Лондон' })
const george = lead({ id: 'george', firstName: 'Георгий', lastName: 'Ларин', role: 'Редактор', why: 'Пишет про стартапы', tags: ['Медиа'], source: 'Конференция РИФ' })
const all = [david, arman, milana, george]

describe('search in the reserve', () => {
  it('filterLeads: all words must occur, case and case forms do not matter', () => {
    expect(filterLeads('юрист дубай', all).map(l => l.id)).toEqual(['arman'])
    expect(filterLeads('ДАВИД', all).map(l => l.id)).toEqual(['david'])
    expect(filterLeads('инвесторы', all).map(l => l.id)).toEqual(['david'])
    expect(filterLeads('web summit', all).map(l => l.id)).toEqual(['david'])
  })
  it('an empty query: everyone; a query with no matches: nobody', () => {
    expect(filterLeads('', all)).toHaveLength(4)
    expect(filterLeads('жонглёр', all)).toEqual([])
  })
  it('also searches by contacts', () => {
    const l = lead({ firstName: 'Икс', channels: [{ type: 'telegram', value: 'x_unique' }] })
    expect(filterLeads('x_unique', [l, david])).toEqual([l])
  })
})

describe('askReserve: semantic search', () => {
  it('"who can help with a visa to the UAE" → the relocation lawyer first', () => {
    const hits = askReserve('кто поможет с визой в ОАЭ', all)
    expect(hits[0].lead.id).toBe('arman')
    expect(hits[0].reason).toMatch(/Чем ценен|Должность/)
  })
  it('"investor for fintech" → David', () => {
    expect(askReserve('нужен инвестор для fintech', all)[0].lead.id).toBe('david')
  })
  it('synonyms: "PR" finds media and journalists', () => {
    expect(askReserve('нужен пиар', all).map(h => h.lead.id)).toContain('george')
  })
  it('weak matches are cut off, the limit is respected', () => {
    expect(askReserve('мороженое', all)).toEqual([])
    expect(askReserve('дубай', all, 1)).toHaveLength(1)
  })
  it('a strong contact ranks higher at equal scores', () => {
    const twin = { ...david, id: 'twin', star: false }
    const hits = askReserve('инвестор', [twin, david])
    expect(hits[0].lead.id).toBe('david')
  })
  it('the reason is trimmed and names the field', () => {
    const long = lead({ id: 'long', firstName: 'Л', why: `инвестор ${'очень '.repeat(40)}`, tags: [] })
    const [h] = askReserve('инвестор', [long])
    expect(h.reason.startsWith('Чем ценен: ')).toBe(true)
    expect(h.reason.length).toBeLessThan(90)
  })
  it('scoreLead with no matches gives 0', () => {
    expect(scoreLead(expandNeed('космос'), david)).toEqual({ score: 0, reason: '' })
  })
})

describe('reserveMatches: "who in the network is looking, and who in the reserve has it"', () => {
  const hasan = person({ id: 'hasan', firstName: 'Хасан', role: 'Основатель', lookingFor: 'Инвестор для seed-раунда, fintech MENA' })
  const rustam = person({ id: 'rustam', firstName: 'Рустам', role: 'Продакт', lookingFor: 'UX-дизайнер для мобильного приложения' })
  it('picks the best fit for each request', () => {
    const m = reserveMatches([hasan, rustam], all)
    expect(m.find(x => x.person.id === 'hasan')?.lead.id).toBe('david')
    expect(m.find(x => x.person.id === 'rustam')?.lead.id).toBe('milana')
  })
  it('one contact is not offered to two people, one person gets one card', () => {
    const twin = person({ id: 'twin', firstName: 'Тёзка', lookingFor: 'Инвестор для fintech' })
    const m = reserveMatches([hasan, twin], [david])
    expect(m).toHaveLength(1)
  })
  it('if the person fits their own request, it is noise: skip', () => {
    const investorSeekingInvestors = person({ id: 'i', firstName: 'Инвестор', role: 'Инвестор фонда', tags: ['Инвестор'], lookingFor: 'Инвестор в сеть' })
    expect(reserveMatches([investorSeekingInvestors], [david])).toEqual([])
  })
  it('an empty reserve and empty requests', () => {
    expect(reserveMatches([hasan], [])).toEqual([])
    expect(reserveMatches([person({ firstName: 'Тихий' })], all)).toEqual([])
  })
  it('respects the limit and the archive', () => {
    expect(reserveMatches([{ ...hasan, archived: true }], all)).toEqual([])
    const many = Array.from({ length: 10 }, (_, i) => lead({ id: `x${i}`, firstName: `И${i}`, role: `инвестор ${i}`, why: 'инвестор fintech' }))
    const seekers = Array.from({ length: 10 }, (_, i) => person({ id: `s${i}`, firstName: `С${i}`, lookingFor: 'инвестор fintech' }))
    expect(reserveMatches(seekers, many, 3).length).toBeLessThanOrEqual(3)
  })
})

describe('localLeadDrafts: a first message to a stranger', () => {
  const d = localLeadDrafts(david, 'Макс')
  it('formal address, with a name, an introduction and the source in quotes', () => {
    for (const t of [d.short, d.warm, d.business]) {
      expect(t.startsWith('Давид, здравствуйте!')).toBe(true)
      expect(t).toContain('Меня зовут Макс.')
      expect(t).toContain('Ваш контакт у меня из «Web Summit».')
      expect(t).not.toMatch(/\bты\b|\bтебе\b|\bтвой\b/i)
    }
  })
  it('gender-neutral: no "рад/готов" and no first-person past tense', () => {
    const text = `${d.short} ${d.warm} ${d.business}`
    expect(text).not.toMatch(/\b(рад|рада|готов|готова|хотел|хотела|писал|писала|увидел|увидела)\b/i)
  })
  it('the warm variant relies on the role and company, the business one offers 15 minutes', () => {
    expect(d.warm).toContain('Вижу, что вы — управляющий партнёр в «Northwind Capital».')
    expect(d.business).toMatch(/15 минут/)
  })
  it('the short one is the shortest; all three differ', () => {
    expect(d.short.length).toBeLessThan(d.warm.length)
    expect(new Set([d.short, d.warm, d.business]).size).toBe(3)
  })
  it('little data: no junk and no double spaces, it also works without the user\'s name', () => {
    const bare = localLeadDrafts(lead({ firstName: 'Анна' }), '')
    for (const t of [bare.short, bare.warm, bare.business]) {
      expect(t).not.toMatch(/undefined|null|Меня зовут \./)
      expect(t).not.toMatch(/ {2,}/)
      expect(t.startsWith('Анна, здравствуйте!')).toBe(true)
    }
  })
  it('a tag instead of a role', () => {
    expect(localLeadDrafts(lead({ firstName: 'Анна', tags: ['Юрист'] }), 'Макс').warm).toContain('«Юрист»')
  })
})

describe('leadLine', () => {
  it('role → why valuable → company → city → source', () => {
    expect(leadLine({ role: 'CTO', company: 'Acme' })).toBe('CTO · Acme')
    expect(leadLine({ why: 'Сильный инвестор', company: 'Acme' })).toBe('Сильный инвестор')
    expect(leadLine({ company: 'Acme', city: 'Дубай' })).toBe('Acme')
    expect(leadLine({ city: 'Дубай', source: 'Чат' })).toBe('Дубай')
    expect(leadLine({ source: 'Чат' })).toBe('Чат')
    expect(leadLine({})).toBe('')
  })
})
