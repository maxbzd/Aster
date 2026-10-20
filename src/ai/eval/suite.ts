import * as z from 'zod/v4'
import { blankPerson } from '@/data/actions'
import { DAY, toISODate } from '@/lib/format'
import type { Circle, Interaction, Person } from '@/data/types'
import { dossier, memoryBlock, namesIndex, networkIndex, todayLine } from '../context'
import { extractJson } from '../compat'
import { withLocale } from '@/i18n'
import { prompts } from '../prompts'
import { AskSchema, BriefSchema, CaptureSchema, ChatSchema, DraftsSchema } from '../schemas'

/**
 * Compares models on Astra's tasks: parsing notes, chatting over records, searching the network, drafts, the pre-meeting brief.
 * The people and records are made up. The model is called through the `chat` function you pass in, so the suite works both in a test
 * (a direct request to a gateway with a key from a file) and in the app (through the server function, where the key stays on the server).
 *
 * The suite always runs in English: prompts and context are built with the English locale and the checks read English answers.
 */

export type ChatFn = (model: string, messages: Array<{ role: string; content: string }>) => Promise<{ text: string; inTok: number; outTok: number }>

export interface Call { text: string; ms: number; inTok: number; outTok: number; repaired: boolean; error?: string }
export interface CaseResult { call: Call; issues: string[]; shown: string }
export interface Case { id: string; group: string; title: string; go: (model: string, chat: ChatFn) => Promise<CaseResult> }

/** Builds prompt text in English whatever language the interface is in. */
const en = <T,>(fn: () => T): T => withLocale('en', fn)

/* ---------- the made-up network ---------- */

/** Monday, 5 October 2026: "on Friday" and "on Wednesday" are counted from this date. */
export const EVAL_NOW = new Date(2026, 9, 5, 12, 0, 0).getTime()
const at = (d: number) => EVAL_NOW - d * DAY
const iso = (daysFromNow: number) => toISODate(EVAL_NOW + daysFromNow * DAY)
const circles: Circle[] = [{ id: 'inv', name: 'Investors', emoji: '📈', palette: 'jade', order: 0 }]

const person = (p: Partial<Person>): Person => blankPerson({ createdAt: at(400), updatedAt: at(400), ...p })
const P = {
  oliver: person({ id: 'oliver', firstName: 'Oliver', lastName: 'Stroud', role: 'CTO', company: 'Nord', city: 'London', closeness: 2, lastContactAt: at(10), canHelpMe: 'hiring engineers, intros in Berlin' }),
  nina: person({ id: 'nina', firstName: 'Nina', lastName: 'Larsen', role: 'Designer', city: 'Lisbon', closeness: 2, birthday: '1990-10-21', giftIdeas: 'a book about Portugal', lastContactAt: at(20), family: 'husband Arthur, daughter Eve (4)' }),
  will: person({ id: 'will', firstName: 'William', nickname: 'Will', lastName: 'Ormond', role: 'Partner', company: 'Gulf Capital', city: 'Dubai', circleIds: ['inv'], closeness: 3, lastContactAt: at(200), lookingFor: 'strong AI teams' }),
  adam: person({ id: 'adam', firstName: 'Adam', lastName: 'Isaacs', role: 'Investor', company: 'Falcon VC', city: 'Dubai', circleIds: ['inv'], closeness: 3, lastContactAt: at(40) }),
  helen: person({ id: 'helen', firstName: 'Helen', lastName: 'Fisher', role: 'Lawyer', city: 'Dubai', closeness: 3, lastContactAt: at(300), canHelpMe: 'visas and relocation to the UAE' }),
  alexv: person({ id: 'alexv', firstName: 'Alex', lastName: 'Vaughan', role: 'Chief Risk Officer', company: 'North Bank', city: 'London', closeness: 3, lastContactAt: at(90) }),
  alexk: person({ id: 'alexk', firstName: 'Alex', lastName: 'Kroll', role: 'Founder', company: 'FinFlow', city: 'Tbilisi', closeness: 2, lastContactAt: at(15) }),
  aria: person({ id: 'aria', firstName: 'Aria', lastName: 'Thompson', role: 'Data Scientist', company: 'Lumen', city: 'London', closeness: 3, lastContactAt: at(60) }),
  boris: person({ id: 'boris', firstName: 'Boris', lastName: 'Grin', role: 'Investor', city: 'Berlin', circleIds: ['inv'], closeness: 3, lastContactAt: at(90) }),
}
const people = Object.values(P)
let n = 0
const it = (personIds: string[], type: Interaction['type'], daysAgo: number, extra: Partial<Interaction> = {}): Interaction => ({ id: `ev${++n}`, personIds, type, date: at(daysAgo), createdAt: at(daysAgo), ...extra })
const ints: Interaction[] = [
  it(['oliver'], 'meeting', 30, { title: 'Coffee', note: 'Talked about hiring. I promised to introduce him to Marina from Zalando. He will send me a presentation by Friday.' }),
  it(['oliver'], 'call', 10, { note: 'Agreed to talk again after the holidays. I will send him a list of investors.' }),
  it(['nina'], 'meeting', 60, { title: 'Dinner', note: 'Nina is thinking about moving to Porto in spring. She is worried about the visa bureaucracy and a school for Eve.' }),
  it(['nina'], 'message', 20, { note: 'Asked about good schools in Porto.' }),
  it(['will'], 'meeting', 200, { title: 'Lunch in Dubai' }),
  it(['adam'], 'call', 40),
  it(['adam'], 'meeting', 150),
  it(['helen'], 'meeting', 300, { note: 'Explained how to apply for a residence visa.' }),
]
const byId = new Map(people.map(p => [p.id, p]))

/* ---------- calling the model: the schema in the prompt, one JSON object, one repair attempt ---------- */

async function run<T extends z.ZodType>(model: string, chat: ChatFn, schema: T, system: string, user: string, history: Array<{ role: string; content: string }> = []): Promise<{ call: Call; data?: z.infer<T> }> {
  const sys = `${system}\n\nReply with ONLY one JSON object, no explanations and no markdown, strictly following this JSON schema:\n${JSON.stringify(z.toJSONSchema(schema))}`
  const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: sys }, ...history, { role: 'user', content: user }]
  const t0 = Date.now()
  let inTok = 0
  let outTok = 0
  let repaired = false
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await chat(model, messages)
      inTok += r.inTok
      outTok += r.outTok
      try {
        const parsed = schema.safeParse(extractJson(r.text))
        if (parsed.success) return { call: { text: r.text, ms: Date.now() - t0, inTok, outTok, repaired }, data: parsed.data }
        messages.push({ role: 'assistant', content: r.text }, { role: 'user', content: `The answer did not fit the schema (${parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}). Return the corrected JSON.` })
      } catch {
        messages.push({ role: 'assistant', content: r.text || '{}' }, { role: 'user', content: 'The answer is not a JSON object. Return only JSON that follows the schema.' })
      }
      repaired = true
    }
    return { call: { text: '', ms: Date.now() - t0, inTok, outTok, repaired, error: 'could not get valid JSON in two attempts' } }
  } catch (e) {
    return { call: { text: '', ms: Date.now() - t0, inTok, outTok, repaired, error: e instanceof Error ? e.message : String(e) } }
  }
}

/* ---------- checks ---------- */

const words = (s: string) => (s.toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]{4,}/g) ?? []).map(w => w.slice(0, 5))
/** The share of the claim's words that are in the source: a low share is a sign of invention. */
export const grounded = (claim: string, source: string) => {
  const src = new Set(words(source))
  const w = words(claim)
  return w.length === 0 || w.filter(x => src.has(x)).length / w.length >= 0.5
}
const EMOJI = /\p{Extended_Pictographic}/u

const capture = (id: string, title: string, note: string, check: (plan: z.infer<typeof CaptureSchema>) => string[]): Case => ({
  id, group: 'Parsing a note', title,
  go: async (model, chat) => {
    const { call, data } = await run(model, chat, CaptureSchema, en(() => prompts().capture), en(() => `${todayLine(EVAL_NOW)}\n\n${namesIndex(people)}\n\nUSER'S NOTE:\n${note}`))
    if (!data) return { call, issues: [call.error ?? 'no answer'], shown: call.text }
    const issues = check(data)
    // inventions: every fact and interest must rest on the text of the note
    for (const f of [...data.people.flatMap(p => p.facts), ...data.people.flatMap(p => p.interests)]) if (!grounded(f, note)) issues.push(`possible invention: “${f}”`)
    return { call, issues, shown: JSON.stringify(data, null, 2) }
  },
})

const chatCase = (id: string, title: string, q: string, check: (r: z.infer<typeof ChatSchema>) => string[], history: Array<{ role: string; content: string }> = [], focus: string[] = []): Case => ({
  id, group: 'Chat over records', title,
  go: async (model, chat) => {
    const sys = en(() => `${prompts().chat}\n\n${networkIndex(people, circles, EVAL_NOW)}\n\n${memoryBlock(ints, people, focus, true)}`)
    const { call, data } = await run(model, chat, ChatSchema, sys, en(() => `${todayLine(EVAL_NOW)}\n\nQUESTION: ${q}`), history)
    if (!data) return { call, issues: [call.error ?? 'no answer'], shown: call.text }
    const issues = check(data)
    for (const c of data.people) if (!byId.has(c.id)) issues.push(`invented person id: ${c.id}`)
    return { call, issues, shown: JSON.stringify(data, null, 2) }
  },
})

const txt = (r: z.infer<typeof ChatSchema>) => `${r.answer} ${r.quotes.map(q => q.text).join(' ')}`.toLowerCase()

export const CASES: Case[] = [
  capture('cap-existing', 'A known person by name, promises and a "by Friday" deadline',
    'Had coffee with Oliver yesterday, he says he is moving to Berlin in January. He promised to introduce me to Marina from Zalando. I have to send him the presentation by Friday.',
    r => {
      const out: string[] = []
      if (!r.people.some(p => p.existing_id === 'oliver')) out.push('did not recognise Oliver from the network (existing_id)')
      if (r.people.some(p => p.existing_id !== 'oliver' && p.existing_id !== null)) out.push('linked someone extra to an existing card')
      if (!r.reminders.some(x => /presentation/i.test(x.text) && x.due_date === iso(4))) out.push(`no reminder about the presentation for Friday ${iso(4)}: ${JSON.stringify(r.reminders)}`)
      if (!r.interaction) out.push('no record of the meeting')
      return out
    }),
  capture('cap-new', 'A new person: name, company, city, contact, interest',
    'Met Kate Smith at the conference: a designer at Spotify, lives in Berlin, loves running. Her Telegram is @kate_s.',
    r => {
      const out: string[] = []
      const k = r.people.find(p => /kat/i.test(p.first_name))
      if (!k) return ['did not create a card for Kate']
      if (k.existing_id) out.push('linked the new Kate to an existing person')
      if (!/smith/i.test(k.last_name ?? '')) out.push('no last name')
      if (!/spotify/i.test(k.company ?? '')) out.push('no company Spotify')
      if (!/berlin/i.test(k.city ?? '')) out.push('no city Berlin')
      if (!k.channels.some(c => /kate_s/i.test(c.value))) out.push('lost the Telegram handle')
      if (!/design/i.test(k.role ?? '')) out.push('no role "designer"')
      return out
    }),
  capture('cap-nick', 'A short name, "Will", and a deadline "on Wednesday"',
    'Had a call with Will. He is looking for strong AI teams for his round. On Wednesday I will send him a list of startups.',
    r => {
      const out: string[] = []
      if (!r.people.some(p => p.existing_id === 'will')) out.push('did not recognise "Will" as William Ormond')
      if (!r.reminders.some(x => x.due_date === iso(2))) out.push(`no reminder for Wednesday ${iso(2)}: ${JSON.stringify(r.reminders)}`)
      return out
    }),
  capture('cap-ambiguous', 'Two Alexes: choose by context',
    'Met Alex from the bank, we discussed scoring for small businesses. He knows how the regulator’s inspections go.',
    r => {
      const a = r.people.find(p => /alex/i.test(p.first_name))
      if (!a) return ['did not find Alex']
      return a.existing_id === 'alexv' ? [] : [`chose not Vaughan from the bank but ${a.existing_id ?? 'a new person'}`]
    }),
  capture('cap-minimal', 'A short note: invent nothing',
    'Had dinner with Nina.',
    r => {
      const out: string[] = []
      if (!r.people.some(p => p.existing_id === 'nina')) out.push('did not recognise Nina')
      if (r.reminders.length) out.push(`invented reminders: ${JSON.stringify(r.reminders)}`)
      if (r.people.some(p => p.facts.length || p.interests.length || p.topics.length)) out.push('invented facts or topics')
      if (r.people.length !== 1) out.push(`people in the plan: ${r.people.length}, expected 1`)
      return out
    }),
  capture('cap-family', "A person's family and plans",
    'Nina told me their second child was born, a son named Leo, and that they are finally moving to Porto in spring.',
    r => {
      const nina = r.people.find(p => p.existing_id === 'nina')
      if (!nina) return ['did not recognise Nina']
      const out: string[] = []
      if (!/leo/i.test(`${nina.family ?? ''} ${nina.facts.join(' ')}`)) out.push('did not save the son Leo')
      if (!/porto/i.test(`${nina.city ?? ''} ${nina.facts.join(' ')} ${nina.topics.join(' ')} ${r.interaction?.summary ?? ''}`)) out.push('lost the plan to move to Porto')
      return out
    }),

  chatCase('chat-promises', 'What I promised Oliver: my promises apart from his', 'What did I promise Oliver?', r => {
    const out: string[] = []
    const mine = r.quotes.filter(q => q.kind === 'mine').map(q => q.text).join(' ').toLowerCase()
    const theirs = r.quotes.filter(q => q.kind === 'theirs').map(q => q.text).join(' ').toLowerCase()
    if (!/marina/.test(mine)) out.push('no promise to introduce Marina among "mine"')
    if (!/list/.test(mine)) out.push('no promise to send the list of investors among "mine"')
    if (!/presentation/.test(theirs)) out.push('no presentation promised by Oliver among "promised to me"')
    if (/presentation/.test(mine)) out.push('mixed up: Oliver promised the presentation, not the user')
    return out
  }, [], ['oliver']),
  chatCase('chat-topic', 'What Nina and I discussed about the move', 'What did Nina and I talk about regarding the move?', r => {
    const value2 = txt(r)
    const out: string[] = []
    if (!/porto/.test(value2)) out.push('no Porto')
    if (!/visa|bureaucra/.test(value2)) out.push('no worry about the visa and bureaucracy')
    if (!/school/.test(value2)) out.push('no school')
    return out
  }, [], ['nina']),
  chatCase('chat-segment', "Haven't seen for a long time: investors in Dubai", "Which investors in Dubai haven't I seen for a long time?", r => {
    const ids = r.people.map(p => p.id)
    const out: string[] = []
    if (!ids.includes('will')) out.push('no Will')
    if (!ids.includes('adam')) out.push('no Adam')
    if (ids.includes('helen')) out.push('extra Helen: she is a lawyer, not an investor')
    if (ids.includes('boris')) out.push('extra Boris: he is in Berlin')
    if (ids.includes('will') && ids.includes('adam') && ids.indexOf('will') > ids.indexOf('adam')) out.push('order: Will has not been seen for longer, he should be first')
    return out
  }),
  chatCase('chat-followup', 'A follow-up: "do I owe him anything else?"', 'Do I owe him anything else?', r => {
    const out: string[] = []
    if (!r.people.some(p => p.id === 'oliver') && r.focus_person_id !== 'oliver') out.push('did not understand that "him" is Oliver from the previous turn')
    if (!/list|marina/.test(txt(r))) out.push("did not recall the promises to Oliver")
    return out
  }, [{ role: 'user', content: 'What did I promise Oliver?' }, { role: 'assistant', content: 'You promised Oliver to introduce him to Marina from Zalando.' }], ['oliver']),
  chatCase('chat-unknown', 'No data: say so honestly instead of inventing', 'What did I promise Aria?', r => {
    const out: string[] = []
    if (r.quotes.length) out.push(`invented quotes: ${JSON.stringify(r.quotes)}`)
    if (!/\bno\b|\bnot\b|nothing|n't|none|empty|absent|haven't/i.test(r.answer)) out.push('the answer does not say plainly that there is no data')
    return out
  }, [], ['aria']),

  {
    id: 'ask-visa', group: 'Ask the network', title: 'Who can help with a UAE visa',
    go: async (model, chat) => {
      const { call, data } = await run(model, chat, AskSchema, en(() => `${prompts().ask}\n\n${networkIndex(people, circles, EVAL_NOW)}`), en(() => `${todayLine(EVAL_NOW)}\n\nQUESTION: Who can help with a UAE visa?`))
      if (!data) return { call, issues: [call.error ?? 'no answer'], shown: call.text }
      const ids = data.people.map(p => p.id)
      const issues: string[] = []
      if (ids[0] !== 'helen') issues.push(`the first should be the lawyer Helen, not ${ids[0] ?? 'nobody'}`)
      for (const id of ids) if (!byId.has(id)) issues.push(`invented id: ${id}`)
      if (ids.some(id => ['oliver', 'aria', 'nina'].includes(id))) issues.push('people with no link to the UAE in the list')
      return { call, issues, shown: JSON.stringify(data, null, 2) }
    },
  },

  ...([
    ['draft-bday', "Nina's birthday", 'OCCASION: a birthday in 16 days (21 October), turning 36'],
    ['draft-reconnect', 'Reconnect with Will', 'OCCASION: simply have not talked in a long while (over six months); Will is looking for strong AI teams'],
  ] as const).map(([id, title, occasion]): Case => ({
    id, group: 'Message draft', title,
    go: async (model, chat) => {
      const p = id === 'draft-bday' ? P.nina : P.will
      const content = en(() => `${todayLine(EVAL_NOW)}\nSender: Sam\n\n${dossier(p, ints.filter(i => i.personIds.includes(p.id)), [], byId, true, EVAL_NOW)}\n\n${occasion}`)
      const { call, data } = await run(model, chat, DraftsSchema, en(() => prompts().draft), content)
      if (!data) return { call, issues: [call.error ?? 'no answer'], shown: call.text }
      const issues: string[] = []
      for (const [k, v] of Object.entries(data)) {
        if (!v.trim()) issues.push(`empty variant “${k}”`)
        if (id === 'draft-reconnect' && EMOJI.test(v)) issues.push(`“${k}”: emoji with no festive occasion`)
        if (/hope (?:this|you).{0,30}(?:well|good)/i.test(v)) issues.push(`“${k}”: the cliché "hope you're well"`)
      }
      if (id === 'draft-reconnect' && !/\bai\b|team|startup/i.test(Object.values(data).join(' '))) issues.push('did not use a detail from the card (AI teams)')
      if (id === 'draft-bday' && !/birthday|happy|36/i.test(Object.values(data).join(' '))) issues.push('not about the birthday')
      return { call, issues, shown: Object.entries(data).map(([k, v]) => `**${k}:** ${v}`).join('\n\n') }
    },
  })),

  {
    id: 'brief-oliver', group: 'Pre-meeting brief', title: 'A brief on Oliver: promises by side',
    go: async (model, chat) => {
      const content = en(() => `${todayLine(EVAL_NOW)}\nUser: Sam\n\n${dossier(P.oliver, ints.filter(i => i.personIds.includes('oliver')), [], byId, true, EVAL_NOW)}\n\nPrepare a brief before meeting this person.`)
      const { call, data } = await run(model, chat, BriefSchema, en(() => prompts().brief), content)
      if (!data) return { call, issues: [call.error ?? 'no answer'], shown: call.text }
      const issues: string[] = []
      const mine = data.promises_mine.join(' ').toLowerCase()
      const theirs = data.promises_theirs.join(' ').toLowerCase()
      if (!/marina/.test(mine)) issues.push('no promise of mine about Marina')
      if (!/presentation/.test(theirs)) issues.push("no promise from Oliver about the presentation")
      if (/presentation/.test(mine)) issues.push('mixed up the sides of the presentation promise')
      if (!data.opener.trim()) issues.push('no conversation opener')
      return { call, issues, shown: JSON.stringify(data, null, 2) }
    },
  },
]

/* ---------- running and the report ---------- */

export interface Row { model: string; c: Case; call: Call; issues: string[]; shown: string }
export interface Summary { model: string; ok: number; total: number; errors: number; repaired: number; sec: number; inTok: number; outTok: number }

/** Models run in parallel, the cases of one model one after another: that keeps gateways from complaining about rate limits. */
export async function runSuite(models: string[], chat: ChatFn, onRow?: (row: Row, done: number, total: number) => void, signal?: AbortSignal, cases: Case[] = CASES): Promise<Row[]> {
  const rows: Row[] = []
  const total = models.length * cases.length
  await Promise.all(models.map(async model => {
    for (const c of cases) {
      if (signal?.aborted) return
      const r = await c.go(model, chat)
      const row = { model, c, ...r }
      rows.push(row)
      onRow?.(row, rows.length, total)
    }
  }))
  return rows
}

export function summarize(models: string[], rows: Row[]): Summary[] {
  return models.map(m => {
    const mine = rows.filter(r => r.model === m)
    const sum = (f: (c: Call) => number) => mine.reduce((s, r) => s + f(r.call), 0)
    return { model: m, ok: mine.filter(r => r.issues.length === 0 && !r.call.error).length, total: mine.length, errors: mine.filter(r => r.call.error).length, repaired: mine.filter(r => r.call.repaired).length, sec: Math.round(sum(c => c.ms) / 1000), inTok: sum(c => c.inTok), outTok: sum(c => c.outTok) }
  })
}

export function buildReport(models: string[], rows: Row[], source: string, cases: Case[] = CASES): string {
  const md: string[] = ['# Model comparison on Astra’s tasks', '', `Date: ${new Date().toISOString()}`, `Source: ${source}`, '', '| Model | Passed | Request errors | Needed JSON repair | Time, s | Tokens in / out |', '|---|---|---|---|---|---|']
  for (const item of summarize(models, rows)) md.push(`| ${item.model} | ${item.ok} of ${item.total} | ${item.errors} | ${item.repaired} | ${item.sec} | ${item.inTok} / ${item.outTok} |`)
  for (const c of cases) {
    md.push('', `## ${c.group}: ${c.title}`, '')
    for (const m of models) {
      const r = rows.find(x => x.model === m && x.c.id === c.id)
      if (!r) continue
      md.push(`### ${m} — ${r.call.error ? '⚠ error' : r.issues.length ? '✗ issues' : '✓ no issues'}  (${(r.call.ms / 1000).toFixed(1)} s)`, '')
      if (r.call.error) md.push(`Error: ${r.call.error}`, '')
      for (const i of r.issues) md.push(`- ${i}`)
      md.push('', '```', r.shown.slice(0, 3500), '```', '')
    }
  }
  return md.join('\n')
}
