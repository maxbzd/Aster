import { describe, expect, it } from 'vitest'
import { localCapture, localNoteSuggest } from '@/ai/local/parse'
import { NOW, person } from '../helpers'

const alina = person({ id: 'al', firstName: 'Алина', lastName: 'Воронцова', role: 'Основатель', company: 'Lumen Labs' })
const daniil = person({ id: 'da', firstName: 'Даниил', lastName: 'Огнев', role: 'CTO' })
const people = [alina, daniil]

describe('localCapture: parsing a note after a meeting', () => {
  it('a new acquaintance: the name in the nominative, role, place, agreement', () => {
    const plan = localCapture('Познакомился с Артёмом Беловым на ужине у Алины — он CTO в финтехе, в марте переезжает в Дубай. Договорились созвониться в пятницу.', people, NOW)
    const [p] = plan.people
    expect(plan.people).toHaveLength(1)
    expect(p).toMatchObject({ first_name: 'Артём', last_name: 'Белов', existing_id: null, role: 'CTO', met_place: 'Ужин у Алины' })
    expect(p.interests).toContain('Fintech')
    expect(p.topics.join(' ')).toMatch(/Дубай/)
    expect(plan.reminders).toEqual([{ person_ref: 'p1', text: 'Созвониться с Артёмом', due_date: '2026-10-09' }])
    expect(plan.interaction).toMatchObject({ type: 'meeting', title: 'Ужин у Алины', person_refs: ['p1'] })
    expect(plan.summary).toMatch(/Новое знакомство: Артём/)
  })

  it('an acquaintance from the network is recognised by case, a call is detected by the verb', () => {
    const plan = localCapture('Вчера созвонилась с Алиной, она ищет CTO для нового проекта. Обещал познакомить с Даниилом.', people, NOW)
    expect(plan.people).toHaveLength(1)
    expect(plan.people[0]).toMatchObject({ existing_id: 'al', first_name: 'Алина', looking_for: 'CTO для нового проекта' })
    expect(plan.interaction?.type).toBe('call')
    expect(plan.interaction?.title).toBe('Созвон с Алиной')
  })

  it('"looking for a CTO" is a request, not the person\'s job title', () => {
    const plan = localCapture('Катя Смирнова, она ищет CTO в стартап', people, NOW)
    expect(plan.people[0].role).toBeNull()
    expect(plan.people[0].looking_for).toMatch(/CTO/)
  })

  it('the note starts with a name: profession, company, city, birthday, hobbies', () => {
    const [p] = localCapture('Катя Смирнова, дизайнер в Spotify, живёт в Берлине. День рождения 14 мая. Любит бег и вино.', people, NOW).people
    expect(p).toMatchObject({ first_name: 'Катя', last_name: 'Смирнова', role: 'Дизайнер', company: 'Spotify', city: 'Берлин', birthday: '--05-14' })
    expect(p.facts).toContain('Любит бег и вино')
  })

  it('family: a wife, a son with an age', () => {
    const [p] = localCapture('Познакомился с Игорем. Жена Маша, сын Лёва 5 лет.', people, NOW).people
    expect(p.family).toBe('Жена Маша, сын Лёва (5 лет)')
  })

  it('contacts from the text: phone, email, handle', () => {
    const [p] = localCapture('Познакомился с Борисом, его номер +7 900 123-45-67, почта boris@acme.io, телеграм @boris_k', people, NOW).people
    expect(p.channels).toEqual(expect.arrayContaining([
      { type: 'phone', value: '+7 900 123-45-67' }, { type: 'email', value: 'boris@acme.io' }, { type: 'telegram', value: 'boris_k' },
    ]))
  })

  it('several acquaintances: the main one is the one named first', () => {
    const plan = localCapture('Ужинали с Даниилом и Алиной в субботу', people, NOW)
    expect(plan.people.map(p => p.first_name)).toEqual(['Даниил', 'Алина'])
    expect(plan.people.every(p => p.existing_id)).toBe(true)
    expect(plan.interaction?.person_refs).toEqual(['p1', 'p2'])
    expect(plan.interaction?.title).toBe('Встреча: Даниил, Алина')
  })

  it('a namesake from the network with a different last name is a new person, not a merge with someone else\'s card', () => {
    const fedor = person({ id: 'fv', firstName: 'Фёдор', lastName: 'Ветров', role: 'Юрист' })
    const plan = localCapture('Фёдор Новиков, основатель в Notion, договорились созвониться', [fedor], NOW)
    expect(plan.people).toHaveLength(1)
    expect(plan.people[0]).toMatchObject({ first_name: 'Фёдор', last_name: 'Новиков', existing_id: null })
    // and if the last name is the same, it is an acquaintance
    const same = localCapture('Фёдор Ветров, созвонились сегодня', [fedor], NOW)
    expect(same.people[0].existing_id).toBe('fv')
  })

  it('text with no names does not turn into a person named "Просто"', () => {
    const plan = localCapture('Просто текст без имён и событий', people, NOW)
    expect(plan.people).toEqual([])
    expect(plan.interaction).toBeNull()
    expect(plan.summary).toMatch(/не нашла имени/i)
  })

  it('a leading conjunction or adverbial is not counted as a name', () => {
    for (const t of ['Сегодня был на встрече, всё прошло отлично', 'Вчера обсуждали планы на год', 'Надо не забыть позвонить'])
      expect(localCapture(t, people, NOW).people).toEqual([])
  })

  it('a promise "I promised…" turns into a reminder with a date', () => {
    const plan = localCapture('Созвонились с Алиной. Я пообещал прислать презентацию завтра', people, NOW)
    expect(plan.reminders.some(r => /презентац/i.test(r.text) && r.due_date === '2026-10-06')).toBe(true)
  })

  it('empty text', () => {
    expect(localCapture('   ', people, NOW)).toEqual({ summary: '', people: [], interaction: null, reminders: [] })
  })

  it('does not create duplicate reminders', () => {
    const plan = localCapture('Познакомился с Артёмом. Договорились созвониться завтра. Договорились созвониться завтра.', people, NOW)
    const texts = plan.reminders.map(r => r.text)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('a long text is cut into the meeting summary', () => {
    const plan = localCapture(`Познакомился с Артёмом. ${'Очень длинная история. '.repeat(60)}`, people, NOW)
    expect((plan.interaction?.summary.length ?? 0)).toBeLessThanOrEqual(401)
  })

  it('the result always passes the schema (the references to people are consistent)', () => {
    const plan = localCapture('Познакомился с Артёмом и Борисом. Договорились созвониться.', people, NOW)
    const refs = new Set(plan.people.map(p => p.ref))
    for (const r of plan.interaction?.person_refs ?? []) expect(refs.has(r)).toBe(true)
    for (const r of plan.reminders) if (r.person_ref) expect(refs.has(r.person_ref)).toBe(true)
    for (const r of plan.reminders) expect(r.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('localNoteSuggest: hints from a note about a person', () => {
  const text = 'Перезвонить после отпуска. Жена Маша, сын Лёва 5 лет. Ищет инвестора в seed. Любит джаз.'
  const kinds = (t: string, p = alina) => localNoteSuggest(t, p, people, NOW).items

  it('a reminder, family, a fact, a request', () => {
    const items = kinds(text)
    expect(items).toEqual(expect.arrayContaining([
      { kind: 'reminder', text: 'Перезвонить после отпуска', due_date: '2026-10-26' },
      { kind: 'family', text: 'Жена Маша, сын Лёва (5 лет)', due_date: null },
      { kind: 'fact', text: 'Любит джаз', due_date: null },
      { kind: 'looking_for', text: 'Инвестора в seed', due_date: null },
    ]))
  })
  it('no more than five items and no repeats', () => {
    const items = kinds(text)
    expect(items.length).toBeLessThanOrEqual(5)
    const keys = items.map(i => i.kind + i.text.toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('does not suggest what is already saved', () => {
    const known = person({ ...alina, facts: [{ icon: 'heart', text: 'Любит джаз' }], family: 'Жена Маша, сын Лёва (5 лет)', lookingFor: 'Инвестора в seed' })
    const items = localNoteSuggest(text, known, [known], NOW).items
    expect(items.some(i => i.kind === 'family' || i.kind === 'fact' || i.kind === 'looking_for')).toBe(false)
  })
  it('a short note: empty', () => {
    expect(kinds('ок')).toEqual([])
  })
  it('a birthday', () => {
    expect(kinds('У неё день рождения 3 марта 1990, подарить книгу')).toEqual(expect.arrayContaining([{ kind: 'birthday', text: 'День рождения', due_date: '1990-03-03' }]))
  })
})
