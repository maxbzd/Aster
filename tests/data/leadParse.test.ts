import { describe, expect, it } from 'vitest'
import {
  ROLE_LABEL, ROLE_ORDER, autoTags, canonTag, classify, detectCity, detectHeader, extractContacts, guessRoles, leadKeys, leadText, parseLeadText, parseTextList,
  prettyPhone, roleOfHeader, rowToParsed, splitFullName, toLead, type ParsedLead, type Role,
} from '@/data/leadParse'
import { lead, person } from '../helpers'

const ch = (p: ParsedLead) => p.channels.map(c => `${c.type}:${c.value}`)

describe('extractContacts', () => {
  it('pulls out email, phone, handles and links, cleans the remainder', () => {
    const r = extractContacts('Иван, ivan@acme.io, +7 (900) 123-45-67, @ivan_p, https://linkedin.com/in/ivan-petrov-12ab34, инвестор')
    expect(r.channels).toEqual(expect.arrayContaining([
      { type: 'email', value: 'ivan@acme.io' },
      { type: 'phone', value: '+7 (900) 123-45-67' },
      { type: 'telegram', value: 'ivan_p' },
      { type: 'linkedin', value: 'https://linkedin.com/in/ivan-petrov-12ab34' },
    ]))
    expect(r.rest).toBe('Иван, , , , , инвестор')
  })
  it('social networks by links: Telegram, Instagram, X, WhatsApp', () => {
    const r = extractContacts('t.me/anna_k instagram.com/anna.k/ https://x.com/annak wa.me/79001234567')
    expect(r.channels).toEqual([
      { type: 'telegram', value: 'anna_k' }, { type: 'instagram', value: 'anna.k' }, { type: 'x', value: 'annak' }, { type: 'whatsapp', value: '+79001234567' },
    ])
  })
  it('labelled handles: "тг", "инста", "telegram:"', () => {
    const r = extractContacts('тг: ivan_tg, инста ivan.ig')
    expect(r.channels).toEqual(expect.arrayContaining([{ type: 'telegram', value: 'ivan_tg' }, { type: 'instagram', value: 'ivan.ig' }]))
  })
  it('an ordinary site is a website, not garbage', () => {
    expect(extractContacts('сайт https://acme.io/about?utm=1').channels).toEqual([{ type: 'website', value: 'https://acme.io/about' }])
  })
  it('does not take dates, years and short numbers for a phone', () => {
    expect(extractContacts('Встреча 2026-10-05, 12345, 2024 2025').channels).toEqual([])
  })
  it('does not confuse an email with a handle and does not duplicate channels', () => {
    const r = extractContacts('a@b.io a@b.io @a_user @a_user')
    expect(r.channels).toEqual([{ type: 'email', value: 'a@b.io' }, { type: 'telegram', value: 'a_user' }])
  })
  it('an empty string', () => {
    expect(extractContacts('')).toEqual({ rest: '', channels: [] })
  })
})

describe('prettyPhone', () => {
  it.each([
    ['79001234567', '+7 900 123-45-67'], ['89161234567', '+7 916 123-45-67'], ['8 916 555-44-33', '+7 916 555-44-33'],
    ['447911123456', '+447911123456'], ['+7 900 111 22 33', '+7 900 111 22 33'], ['12345', '12345'],
  ])('%s → %s', (raw, nice) => {
    expect(prettyPhone(raw)).toBe(nice)
  })
})

describe('autoTags / canonTag / detectCity', () => {
  it.each([
    ['Партнёр инвестиционного фонда', ['Инвестор']],
    ['Юрист по сделкам M&A', ['Юрист']],
    ['CTO, Rust, AI-инфраструктура', ['AI', 'Разработка']],
    ['Основатель стартапа, миллионер', ['Бизнес']],
    ['Журналист Forbes', ['Медиа']],
    ['просто хороший человек', []],
  ])('«%s»', (text, tags) => {
    expect(autoTags(text)).toEqual(expect.arrayContaining(tags))
    if (!tags.length) expect(autoTags(text)).toEqual([])
  })
  it('no more than three tags', () => {
    expect(autoTags('инвестор юрист дизайнер маркетолог журналист', 3)).toHaveLength(3)
  })
  it('canonTag brings synonyms to one tag', () => {
    expect(canonTag('инвесторы')).toBe('Инвестор')
    expect(canonTag('investor')).toBe('Инвестор')
    expect(canonTag('fintech')).toBe('Fintech')
    expect(canonTag('  ')).toBe('')
    expect(canonTag('очень длинный тег про всё подряд')).toBe('Очень длинный тег про всё подряд')
  })
  it.each([['живёт в Дубае', 'Дубай'], ['из Москвы', 'Москва'], ['Berlin office', 'Берлин'], ['ближе к Петербургу', 'Санкт-Петербург'], ['Тбилиси', 'Тбилиси']])('city: %s', (text, city) => {
    expect(detectCity(text)).toBe(city)
  })
  it('no city: undefined', () => expect(detectCity('где-то на севере')).toBeUndefined())
})

describe('splitFullName', () => {
  it.each([
    ['Иван Петров', 'Иван', 'Петров'],
    ['Иванов Иван Иванович', 'Иван', 'Иванов'], // a full name with a patronymic
    ['Иван Иванович Петров', 'Иван', 'Петров'],
    ['иван', 'Иван', undefined],
    ['анна-мария ли', 'Анна-Мария', 'Ли'],
  ])('%s', (text, first, last) => {
    expect(splitFullName(text)).toEqual({ first, last })
  })
})

describe('parseLeadText: one contact from free text', () => {
  it('name, description, city, handle and phone in one line', () => {
    const p = parseLeadText('Иван Петров — фонд Northwind, Дубай, @ivan_petrov +971 50 123 4567')
    expect(p).toMatchObject({ firstName: 'Иван', lastName: 'Петров', city: 'Дубай', why: 'фонд Northwind' })
    expect(p.tags).toContain('Инвестор')
    expect(ch(p)).toEqual(['telegram:ivan_petrov', 'phone:+971 50 123 4567'])
  })
  it('only a LinkedIn link: the name is taken from the address', () => {
    const p = parseLeadText('https://www.linkedin.com/in/anna-lebedeva-4a2b1c9/')
    expect([p.firstName, p.lastName]).toEqual(['Anna', 'Lebedeva'])
    expect(p.channels[0].type).toBe('linkedin')
  })
  it('only a handle and a description: the name from the handle, the description into "why valuable"', () => {
    const p = parseLeadText('@ivan_petrov миллионер, фонд в Дубае')
    expect([p.firstName, p.lastName]).toEqual(['Ivan', 'Petrov'])
    expect(p.why).toBe('миллионер, фонд в Дубае')
    expect(p.city).toBe('Дубай')
    expect(p.tags).toEqual(expect.arrayContaining(['Инвестор', 'Бизнес']))
  })
  it('a full name with a patronymic', () => {
    const p = parseLeadText('Иванов Иван Иванович, директор по продажам, +7 (900) 123-45-67')
    expect([p.firstName, p.lastName]).toEqual(['Иван', 'Иванов'])
    expect(p.tags).toContain('Продажи')
  })
  it('all lower case: the name is capitalised, the role stays a description', () => {
    const p = parseLeadText('иван петров инвестор')
    expect([p.firstName, p.lastName, p.why]).toEqual(['Иван', 'Петров', 'инвестор'])
  })
  it('brackets go into the description', () => {
    const p = parseLeadText('Давид Шварц (партнёр фонда) t.me/dshwarz, instagram: davidsh, Лондон')
    expect(p).toMatchObject({ firstName: 'Давид', lastName: 'Шварц', city: 'Лондон', why: 'партнёр фонда' })
    expect(ch(p)).toEqual(['telegram:dshwarz', 'instagram:davidsh'])
  })
  it('email: the name from the address, the company from the domain (except free providers)', () => {
    expect(parseLeadText('ivan.petrov@acme.io')).toMatchObject({ firstName: 'Ivan', lastName: 'Petrov', company: 'Acme' })
    expect(parseLeadText('ivan.petrov@gmail.com').company).toBeUndefined()
  })
  it('only a phone: the phone becomes the name so the contact is not lost', () => {
    const p = parseLeadText('+7 900 111 22 33')
    expect(p.firstName).toBe('+7 900 111 22 33')
    expect(p.lastName).toBeUndefined()
    expect(ch(p)).toEqual(['phone:+7 900 111 22 33'])
  })
  it('an empty input does not crash', () => {
    expect(parseLeadText('').firstName).toBe('Без имени')
    expect(parseLeadText('   \n  ').channels).toEqual([])
  })
  it('a very long text does not hang the parser', () => {
    const t0 = performance.now()
    parseLeadText(`Иван Петров ${'очень длинное описание '.repeat(2000)} @ivan_p`)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})

describe('parseTextList: a list of lines and blocks', () => {
  it('one line per person, numbers and bullets are removed', () => {
    const list = parseTextList('1. Иван Петров — фонд\n- Анна Ким, юрист, +7 916 123-45-67\n• @solo_handle')
    expect(list.map(p => p.firstName)).toEqual(['Иван', 'Анна', 'Solo'])
    expect(list[1].tags).toContain('Юрист')
  })
  it('blocks separated by a blank line: the first line is the name, the others the description and contacts', () => {
    const list = parseTextList('Иван Петров\nИнвестор, Дубай\n@ivan_p\n\nАнна Лебедева\nЮрист по сделкам\nanna@law.com')
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ firstName: 'Иван', city: 'Дубай' })
    expect(ch(list[1])).toEqual(['email:anna@law.com'])
  })
  it('empty and whitespace', () => {
    expect(parseTextList('')).toEqual([])
    expect(parseTextList('\n\n  \n')).toEqual([])
  })
  it('a big list is parsed quickly', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `Иван Петров${i} — инвестор, Дубай, @user_${i}`).join('\n')
    const t0 = performance.now()
    expect(parseTextList(text)).toHaveLength(2000)
    expect(performance.now() - t0).toBeLessThan(2000)
  })
})

describe('headers and column roles', () => {
  it.each<[string, Role]>([
    ['Имя', 'first'], ['Фамилия', 'last'], ['ФИО', 'fio'], ['Имя и фамилия', 'name'], ['Full name', 'name'], ['Name', 'name'],
    ['Телефон', 'phone'], ['Mobile', 'phone'], ['E-mail', 'email'], ['Почта', 'email'], ['Telegram', 'telegram'], ['тг', 'telegram'],
    ['Instagram', 'instagram'], ['LinkedIn', 'linkedin'], ['Сайт', 'website'], ['Город', 'city'], ['Компания', 'company'], ['Должность', 'role'],
    ['Теги', 'tags'], ['Категория', 'tags'], ['Чем ценен', 'why'], ['Описание', 'why'], ['Откуда', 'source'], ['Источник', 'source'], ['Комментарий', 'notes'],
    ['Что-то странное', 'skip'], ['', 'skip'],
  ])('«%s» → %s', (header, role) => {
    expect(roleOfHeader(header)).toBe(role)
  })
  it('detectHeader: there are headers: yes; data in the first row: no', () => {
    expect(detectHeader([['Имя', 'Телефон'], ['Иван', '+7 900 000 00 00']])).toBe(true)
    expect(detectHeader([['Иван', '+7 900 000 00 00'], ['Анна', '+7 900 111 11 11']])).toBe(false)
    expect(detectHeader([['Имя']])).toBe(false)
  })
  it('every role has a label and a place in the picker', () => {
    for (const r of ROLE_ORDER) expect(ROLE_LABEL[r]).toBeTruthy()
    expect(new Set(ROLE_ORDER).size).toBe(ROLE_ORDER.length)
  })
  it('"First name" without "Last name" with full names counts as first and last name', () => {
    expect(guessRoles(['Имя'], [['Иван Петров'], ['Анна Ким']])).toEqual(['name'])
    expect(guessRoles(['Имя', 'Фамилия'], [['Иван', 'Петров']])).toEqual(['first', 'last'])
  })
  it('without headers the roles are guessed from the content', () => {
    const roles = guessRoles(null, [['Анна Смирнова', 'anna@x.com', '+7 900 111-22-33', '@anna_s'], ['Борис Ким', 'b@k.im', '+7 900 222-33-44', '@boris_k']])
    expect(roles).toEqual(['name', 'email', 'phone', 'telegram'])
  })
  it('a full name with a patronymic is recognised from the content', () => {
    expect(guessRoles(null, [['Иванов Иван Иванович'], ['Петрова Анна Сергеевна']])).toEqual(['fio'])
  })
})

describe('rowToParsed', () => {
  const roles: Role[] = ['first', 'last', 'company', 'role', 'phone', 'email', 'telegram', 'city', 'tags', 'why', 'source']
  const opt = { autoTags: true }
  it('builds a card from a table row', () => {
    const p = rowToParsed(['Иван', 'Петров', 'Northwind', 'Партнёр', '79001234567', 'IVAN@N.vc', '@ivan_p', 'Дубай', 'инвесторы, fintech', 'Seed в MENA', 'Web Summit'], roles, opt)
    expect(p).toMatchObject({ firstName: 'Иван', lastName: 'Петров', company: 'Northwind', role: 'Партнёр', city: 'Дубай', why: 'Seed в MENA', source: 'Web Summit' })
    expect(ch(p as ParsedLead)).toEqual(['phone:+7 900 123-45-67', 'email:ivan@n.vc', 'telegram:ivan_p'])
    expect(p?.tags).toEqual(['Инвестор', 'Fintech'])
  })
  it('an empty row: null', () => {
    expect(rowToParsed(['', '', '', '', '', '', '', '', '', '', ''], roles, opt)).toBeNull()
  })
  it('full name: "Иванов Иван Иванович" → Иван Иванов, while "Mark Levin" is not flipped', () => {
    expect(rowToParsed(['Иванов Иван Иванович'], ['fio'], opt)).toMatchObject({ firstName: 'Иван', lastName: 'Иванов' })
    expect(rowToParsed(['Mark Levin'], ['fio'], opt)).toMatchObject({ firstName: 'Mark', lastName: 'Levin' })
  })
  it('no name but there is a contact: the name is taken from the contact', () => {
    expect(rowToParsed(['anna.kim@acme.io'], ['email'], opt)).toMatchObject({ firstName: 'Anna', lastName: 'Kim', company: 'Acme' })
  })
  it('auto-tags can be switched off; tags from the table are kept', () => {
    const p = rowToParsed(['Инвестор фонда', 'вручную'], ['role', 'tags'], { autoTags: false })
    expect(p).toBeNull() // no name and no contacts: the row is unusable
    const q = rowToParsed(['Иван', 'Инвестор фонда', 'вручную'], ['name', 'role', 'tags'], { autoTags: false })
    expect(q?.tags).toEqual(['Вручную'])
  })
  it('two columns with phones are added together', () => {
    const p = rowToParsed(['Иван', '+7 900 111 22 33', '+7 900 222 33 44'], ['name', 'phone', 'phone'], opt)
    expect(p?.channels.filter(c => c.type === 'phone')).toHaveLength(2)
  })
  it('Telegram without @ and as a link', () => {
    expect(ch(rowToParsed(['Иван', 'ivan_p'], ['name', 'telegram'], opt) as ParsedLead)).toEqual(['telegram:ivan_p'])
    expect(ch(rowToParsed(['Иван', 'https://t.me/ivan_p'], ['name', 'telegram'], opt) as ParsedLead)).toEqual(['telegram:ivan_p'])
  })
  it('an Instagram column with @ stays Instagram', () => {
    expect(ch(rowToParsed(['Иван', '@ivan.ig'], ['name', 'instagram'], opt) as ParsedLead)).toEqual(['instagram:ivan.ig'])
  })
})

describe('finding repeats', () => {
  it('leadKeys: a phone by the last 10 digits, an email ignoring case, a handle without @', () => {
    const k = leadKeys({ firstName: 'Иван', channels: [{ type: 'phone', value: '8 (900) 123-45-67' }, { type: 'email', value: 'A@B.io' }, { type: 'telegram', value: '@Ivan' }] })
    expect(k).toEqual(expect.arrayContaining(['p:9001234567', 'e:a@b.io', 't:ivan']))
  })
  it('the name key is only for "First Last"; a lone first name does not merge namesakes', () => {
    expect(leadKeys({ firstName: 'Иван', channels: [] })).toEqual([])
    expect(leadKeys({ firstName: 'Иван', lastName: 'Петров', channels: [] })).toEqual(['n:иван петров'])
    expect(leadKeys({ firstName: 'Петров', lastName: 'Иван', channels: [] })).toEqual(leadKeys({ firstName: 'Иван', lastName: 'Петров', channels: [] }))
  })
  it('classify tells apart: new, a repeat in the reserve, already in the network, a repeat in the file', () => {
    const parsed = (firstName: string, lastName: string | undefined, phone?: string): ParsedLead => ({ firstName, lastName, tags: [], channels: phone ? [{ type: 'phone', value: phone }] : [] })
    const res = classify([
      parsed('Анна', 'Ким', '+7 900 000 00 01'),
      parsed('Иван', 'Петров'),
      parsed('Олег', 'Сидоров', '+7 900 000 00 03'),
      parsed('Олег', 'Сидоров', '8 900 000 00 03'),
      parsed('Новый', 'Человек'),
    ], [lead({ firstName: 'Анна', lastName: 'Ким', channels: [{ type: 'phone', value: '+79000000001' }] })], [person({ firstName: 'Иван', lastName: 'Петров' })])
    expect(res.map(r => r.kind)).toEqual(['lead', 'person', 'new', 'file', 'new'])
    expect(res[1].matchName).toBe('Иван Петров')
  })
})

describe('toLead', () => {
  it('builds a card: shared tags, source, batch', () => {
    const l = toLead({ firstName: 'Иван', tags: ['Юрист'], channels: [] }, { tags: ['инвесторы'], source: 'Web Summit', batchId: 'b1', createdAt: 5 })
    expect(l).toMatchObject({ firstName: 'Иван', source: 'Web Summit', batchId: 'b1', createdAt: 5 })
    expect(l.tags).toEqual(['Инвестор', 'Юрист'])
  })
  it('the row\'s source beats the shared one; empty fields do not get in', () => {
    const l = toLead({ firstName: 'Иван', source: 'Чат', tags: [], channels: [], lastName: '', company: '' }, { source: 'Файл' })
    expect(l.source).toBe('Чат')
    expect(l.lastName).toBeUndefined()
    expect(l.company).toBeUndefined()
  })
  it('no more than 8 tags', () => {
    expect(toLead({ firstName: 'И', tags: Array.from({ length: 12 }, (_, i) => `Т${i}`), channels: [] }).tags).toHaveLength(8)
  })
  it('leadText gathers everything for search', () => {
    expect(leadText(lead({ firstName: 'Анна', company: 'Acme', tags: ['Юрист'], channels: [{ type: 'email', value: 'a@b.io' }] }))).toBe('Анна Acme Юрист a@b.io')
  })
})
