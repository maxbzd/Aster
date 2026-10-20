import { describe, expect, it } from 'vitest'
import { localChat, parseFilters, resolvePeople, type ChatCtx } from '@/ai/local/chat'
import { DAY } from '@/lib/format'
import type { ChatMessage } from '@/data/types'
import { interaction, NOW, person, reminder } from '../helpers'

const at = (d: number) => NOW - d * DAY

const oleg = person({ id: 'oleg', firstName: 'Олег', lastName: 'Стрелков', company: 'Nord', role: 'CTO', city: 'Москва' })
const nina = person({ id: 'nina', firstName: 'Нина', lastName: 'Лебедева', city: 'Лиссабон', role: 'Дизайнер' })
const dima = person({ id: 'dima', firstName: 'Дмитрий', nickname: 'Дима', city: 'Дубай', role: 'Партнёр', company: 'Gulf Capital', circleIds: ['inv'], lastContactAt: at(200) })
const arman = person({ id: 'arman', firstName: 'Арман', city: 'Дубай', role: 'Инвестор', company: 'Falcon VC', circleIds: ['inv'], lastContactAt: at(40) })
const lena = person({ id: 'lena', firstName: 'Лена', city: 'Дубай', role: 'Юрист', lastContactAt: at(300) })
const boris = person({ id: 'boris', firstName: 'Борис', city: 'Берлин', role: 'Инвестор', circleIds: ['inv'], lastContactAt: at(90) })
const alexey = person({ id: 'alex', firstName: 'Алексей', lastName: 'Орлов' })

const ints = [
  interaction({ personIds: ['oleg'], type: 'meeting', date: at(30), title: 'Кофе', note: 'Обсудили найм. Я обещал познакомить его с Мариной. Он пришлёт презентацию до пятницы.' }),
  interaction({ personIds: ['oleg'], type: 'call', date: at(10), note: 'Договорились созвониться после праздников. Пришлю ему список инвесторов.' }),
  interaction({ personIds: ['nina'], type: 'meeting', date: at(60), title: 'Ужин', note: 'Нина думает о переезде в Порту весной. Боится бюрократии с визой.' }),
  interaction({ personIds: ['nina'], type: 'message', date: at(20), note: 'Спросила про школы для детей.' }),
  interaction({ personIds: ['dima'], type: 'meeting', date: at(200) }),
  interaction({ personIds: ['arman'], type: 'call', date: at(40) }),
  interaction({ personIds: ['arman'], type: 'meeting', date: at(150) }),
  interaction({ personIds: ['lena'], type: 'meeting', date: at(300) }),
]
const circles = [{ id: 'inv', name: 'Инвесторы', emoji: '📈', palette: 'jade' as const, order: 0 }]
const ctx = (over: Partial<ChatCtx> = {}): ChatCtx => ({
  people: [oleg, nina, dima, arman, lena, boris, alexey], interactions: ints, circles, collections: [],
  reminders: [reminder({ personId: 'oleg', text: 'Отправить список инвесторов', dueAt: NOW + 3 * DAY })], history: [], now: NOW, ...over,
})

describe('Chat: promises', () => {
  it('"What did I promise Oleg?": promises are split into mine and promised to me, plus reminders', () => {
    const r = localChat('Что я обещал Олегу?', ctx())
    expect(r.intent).toBe('promises')
    expect(r.cards[0]?.id).toBe('oleg')
    const mine = r.quotes.filter(q => q.kind === 'mine').map(q => q.text).join(' | ')
    expect(mine).toMatch(/познакомить его с Мариной/)
    expect(mine).toMatch(/Пришлю ему список инвесторов/)
    expect(r.quotes.some(q => q.kind === 'theirs' && /презентац/.test(q.text))).toBe(true)
    expect(r.text).toMatch(/напоминани/)
    expect(r.text).toMatch(/Отправить список инвесторов/)
  })

  it('without a name: all my promises across the network', () => {
    const r = localChat('Что я кому обещал?', ctx())
    expect(r.intent).toBe('promises')
    expect(r.cards.map(c => c.id)).toContain('oleg')
  })

  it('if there are no promises, it says so honestly', () => {
    const r = localChat('Что я обещал Нине?', ctx())
    expect(r.text).toMatch(/нет ни обещаний/)
  })
})

describe('Chat: memory of conversations', () => {
  it('"What did Nina and I talk about regarding the move?": finds the right places in the records', () => {
    const r = localChat('О чём мы говорили с Ниной про переезд?', ctx())
    expect(r.intent).toBe('topic')
    expect(r.cards[0]?.id).toBe('nina')
    expect(r.quotes).toHaveLength(1)
    expect(r.quotes[0]?.text).toMatch(/переезд/)
    expect(r.text).not.toMatch(/ничего нет/)
  })

  it('the topic is not in the records: it says so and shows the latest conversations', () => {
    const r = localChat('О чём мы говорили с Ниной про ипотеку?', ctx())
    expect(r.text).toMatch(/ничего нет/)
    expect(r.quotes.length).toBeGreaterThan(0)
  })

  it('a name in any case form and in Latin letters', () => {
    expect(resolvePeople('что я писал Олегу', ctx()).people[0]?.id).toBe('oleg')
    expect(resolvePeople('что у меня с Alexey', ctx()).people[0]?.id).toBe('alex')
    expect(resolvePeople('как там Дима', ctx()).people[0]?.id).toBe('dima')
  })

  it('"did he promise anything else?": understands who is meant from the previous answer', () => {
    const first = localChat('Что я обещал Олегу?', ctx())
    const history: ChatMessage[] = [{ id: 'a', at: NOW, role: 'astra', text: first.text, focus: first.focus }]
    const r = localChat('а когда мы с ним виделись последний раз?', ctx({ history }))
    expect(r.intent).toBe('last')
    expect(r.cards[0]?.id).toBe('oleg')
  })

  it('"when did we last meet" answers with a date and whether the meeting was in person', () => {
    const r = localChat('Когда мы виделись с Ниной в последний раз?', ctx())
    expect(r.intent).toBe('last')
    expect(r.text).toMatch(/Последний контакт/)
  })
})

describe('Chat: selections', () => {
  it('"Which investors in Dubai haven\'t I seen for a while?": by circle and city, the oldest on top', () => {
    const r = localChat('Кого я давно не видел из инвесторов в Дубае?', ctx())
    expect(r.intent).toBe('filter')
    const ids = r.cards.map(c => c.id)
    expect(ids).toEqual(['dima', 'arman'])
    expect(ids).not.toContain('boris') // Berlin
    expect(ids).not.toContain('lena') // Dubai, but not in the investors circle
    expect(r.cards[0]?.reason).toMatch(/виделись/)
  })

  it('"haven\'t seen" counts only real meetings, not calls', () => {
    const f = parseFilters('кого давно не видел из инвесторов', ctx())!
    expect(f.meetingsOnly).toBe(true)
    const r = localChat('кого давно не видел из инвесторов', ctx())
    // Arman has a recent call, but the meeting was 150 days ago: for "haven't seen" he is older than Boris, who has no meetings
    expect(r.cards.map(c => c.id)).toContain('arman')
  })

  it('the refinement "and from Berlin?" inherits the previous conditions', () => {
    const first = localChat('Кого давно не видел из инвесторов в Дубае?', ctx())
    const history: ChatMessage[] = [{ id: 'a', at: NOW, role: 'astra', text: first.text, focus: first.focus }]
    const r = localChat('а из Берлина?', ctx({ history }))
    expect(r.intent).toBe('filter')
    expect(r.cards.map(c => c.id)).toEqual(['boris'])
  })

  it('a role by a word from the cards: "lawyers" finds lawyers', () => {
    const r = localChat('Кто у меня юрист в Дубае?', ctx())
    expect(r.cards.map(c => c.id)).toEqual(['lena'])
  })

  it('lists: "who on the list for the round haven\'t I seen for a while"', () => {
    const coll = { id: 'c1', name: 'Для раунда', emoji: '📈', palette: 'jade' as const, personIds: ['arman', 'lena'], leadIds: [], order: 0, createdAt: 1, updatedAt: 1 }
    const r = localChat('Кого из списка для раунда давно не видел?', ctx({ collections: [coll] }))
    expect(r.cards.map(c => c.id).sort()).toEqual(['arman', 'lena'])
  })
})

describe('Chat: the rest', () => {
  it('a greeting and "what can you do" give hints', () => {
    const r = localChat('Привет', ctx())
    expect(r.intent).toBe('help')
    expect(r.followUps).toHaveLength(3)
  })

  it('a birthday and a dossier', () => {
    const withBd = person({ id: 'bd', firstName: 'Ксения', birthday: '1990-10-21', giftIdeas: 'книга про Лиссабон' })
    const r = localChat('Когда день рождения у Ксении?', ctx({ people: [withBd, oleg] }))
    expect(r.intent).toBe('birthday')
    expect(r.text).toMatch(/21 октября/)
    const a = localChat('Что я знаю про Олега?', ctx())
    expect(a.intent).toBe('about')
    expect(a.text).toMatch(/Nord/)
  })

  it('no name and no conditions: the fallback semantic search, without errors', () => {
    const r = localChat('кто поможет с визой', ctx())
    expect(['search', 'filter']).toContain(r.intent)
    expect(r.text).toBeTruthy()
  })

  it('answers have no names after prepositions without quotes', () => {
    for (const q of ['Что я обещал Олегу?', 'О чём мы говорили с Ниной про переезд?', 'Когда мы виделись с Ниной?']) {
      const r = localChat(q, ctx())
      expect(r.text).not.toMatch(/(?:^|\s)(?:с|про|о|для|к|у|от)\s+(?:Олег|Нин|Алексе)/)
    }
  })
})
