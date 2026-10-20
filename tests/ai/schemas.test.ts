import { describe, expect, it } from 'vitest'
import { AskSchema, BriefSchema, CaptureSchema, DraftsSchema, MatchesSchema, NoteSuggestSchema } from '@/ai/schemas'
import { localAsk } from '@/ai/local/ask'
import { localBrief } from '@/ai/local/brief'
import { localDrafts } from '@/ai/local/drafts'
import { localMatches } from '@/ai/local/matches'
import { localCapture, localNoteSuggest } from '@/ai/local/parse'
import { contactedAgo, interaction, NOW, reminder } from '../helpers'

/**
 * Контракт: локальный движок и облачная модель возвращают одну и ту же форму.
 * Если локальный ответ перестанет проходить схему, UI, рассчитанный на облачный, сломается.
 */
const alina = contactedAgo(40, { id: 'al', firstName: 'Алина', lastName: 'Воронцова', role: 'Основатель', company: 'Lumen Labs', lookingFor: 'CTO', tags: ['AI'] })
const daniil = contactedAgo(90, { id: 'da', firstName: 'Даниил', lastName: 'Огнев', role: 'CTO', canHelpMe: 'Инженерные команды', tags: ['AI'] })
const people = [alina, daniil]
const ints = [interaction({ personIds: ['al'], type: 'meeting', title: 'Кофе' })]

describe('локальные ответы проходят схемы облачной модели', () => {
  it('разбор заметки', () => {
    const plan = localCapture('Познакомился с Артёмом Беловым на ужине у Алины — он CTO. Договорились созвониться в пятницу.', people, NOW)
    expect(() => CaptureSchema.parse(plan)).not.toThrow()
  })
  it('подсказки к заметке', () => {
    expect(() => NoteSuggestSchema.parse(localNoteSuggest('Перезвонить после отпуска. Любит джаз.', alina, people, NOW))).not.toThrow()
  })
  it('вопрос сети', () => {
    expect(() => AskSchema.parse(localAsk('кто знает CTO', people, ints, NOW))).not.toThrow()
  })
  it('бриф перед встречей', () => {
    const byId = new Map(people.map(p => [p.id, p]))
    expect(() => BriefSchema.parse(localBrief(alina, ints, [reminder({ personId: 'al' })], byId, localMatches(people), NOW))).not.toThrow()
  })
  it('черновики сообщений', () => {
    expect(() => DraftsSchema.parse(localDrafts(alina, null, 'Макс', people))).not.toThrow()
  })
  it('сводник', () => {
    const pairs = localMatches(people).map(m => ({ a_id: m.a.id, b_id: m.b.id, reason: m.reason, value: m.value, score: m.score }))
    expect(() => MatchesSchema.parse({ matches: pairs })).not.toThrow()
  })
})

describe('схемы отвергают мусор', () => {
  it('не хватает обязательных полей', () => {
    expect(CaptureSchema.safeParse({ summary: 'x' }).success).toBe(false)
    expect(DraftsSchema.safeParse({ short: 'a', warm: 'b' }).success).toBe(false)
  })
  it('неизвестный тип канала или встречи', () => {
    const base = { ref: 'p1', existing_id: null, first_name: 'А', last_name: null, role: null, company: null, city: null, family: null, facts: [], interests: [], looking_for: null, can_help: null, i_can_help: null, birthday: null, met_place: null, introduced_by_id: null, topics: [], gift_ideas: null }
    const plan = (channels: unknown, type = 'meeting') => ({ summary: '', people: [{ ...base, channels }], interaction: { type, title: '', summary: '', place: null, person_refs: [] }, reminders: [] })
    expect(CaptureSchema.safeParse(plan([{ type: 'telegram', value: 'a' }])).success).toBe(true)
    expect(CaptureSchema.safeParse(plan([{ type: 'fax', value: 'a' }])).success).toBe(false)
    expect(CaptureSchema.safeParse(plan([], 'dance')).success).toBe(false)
  })
  it('score должен быть числом', () => {
    expect(MatchesSchema.safeParse({ matches: [{ a_id: 'a', b_id: 'b', reason: '', value: '', score: 'high' }] }).success).toBe(false)
  })
})
