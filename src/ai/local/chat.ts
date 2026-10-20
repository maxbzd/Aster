import type { ChatFilters, ChatMessage, ChatQuote, Circle, Collection, ID, Interaction, Person, Reminder } from '@/data/types'
import { nextBirthday, warmthOf } from '@/data/logic'
import { agoShort, dateLong, fullName, inDays, jobLine } from '@/lib/format'
import { t, tn } from '@/i18n'
import { nameScore } from '@/lib/names'
import { localAsk, ASK_SYN } from './ask'
import { findMentioned, lower, stem, STOP, words } from './text'

/* A chat with memory. Everything is computed on the device: questions like "what did I promise Oleg?" need no model. Russian and English side by side. */

export interface ChatCtx {
  people: Person[]
  interactions: Interaction[]
  reminders: Reminder[]
  circles: Circle[]
  collections: Collection[]
  history: ChatMessage[]
  now?: number
}

export interface ChatReply {
  text: string
  cards: Array<{ id: ID; reason: string }>
  quotes: ChatQuote[]
  followUps: string[]
  focus?: ChatMessage['focus']
  intent: 'help' | 'promises' | 'topic' | 'last' | 'birthday' | 'about' | 'filter' | 'search'
}

export const chatExamples = () => [
  t('What did I promise Oliver?'),
  t('What did Nina and I talk about regarding the move?'),
  t("Which investors in Dubai haven't I seen in a while?"),
]

const PRONOUN = /(?<![а-яa-z])(?:он|она|они|его|её|ее|ему|ей|им|ним|ней|них|нём|нем|неё|нее|ней|he|she|they|him|them|his|hers?|their|theirs)(?![а-яa-z])/
const PROMISE = /обещ|договор|должен|должна|должны|обязал|пообещ|что\s+(?:мне|я)\s+(?:надо|нужно|стоит)|не\s+забыть|задолжал|promis|\bowe[ds]?\b|agreed|agreement|commit(?:ted|ment)|obligat|forget to|(?:have|need) to/
const ASK_TOPIC = /о\s+чем|что\s+(?:мы\s+)?(?:говорил|обсуждал|обсуждали|писал|рассказывал|рассказал|сказал|решил)|про\s|насчет|по\s+поводу|разговор|what\s+(?:did\s+)?(?:we|i|he|she|they)\s+(?:talk|discuss|say|said|decide|write|wrote|tell|told)|talked about|spoke about|discuss|conversation|regarding|concerning|\babout\b/
const ASK_LAST = /когда\s+.*(?:последн|в\s+последний\s+раз|виделись|общались|созванивались|писал|встречались)|(?:последн\w+)\s+(?:раз|контакт|встреч|разговор)|when\s+.*(?:last|latest|met|meet|talk|spoke|speak|saw|see|chat|call)|\blast\s+(?:time|contact|meeting|conversation)|how long (?:ago|since)/
const ASK_BDAY = /когда\s+.*(?:день\s+рожд|др\b|родил)|день\s+рожд\w+\s+у|when\s+.*(?:birthday|bday|born)|\bbirthday\b|\bbday\b/
const ASK_ABOUT = /что\s+(?:я\s+)?знаю\s+(?:про|о)\s|расскажи\s+(?:про|о)\s|кто\s+так(?:ой|ая)|досье|напомни\s+(?:про|о)\s|what do i know about|tell me about|who is\b|dossier|remind me about|info on/
const STALE = /давно|не\s+вид(?:ел|елись|ели)|не\s+общал|не\s+созванив|не\s+писал|остыл|потерял|забыл|не\s+встреча|haven'?t (?:seen|met|talked|spoken|heard|contacted|written|been in touch)|long time|not seen|lost touch|gone cold|forgot|neglect|overdue|a while/
const MEETING_ONLY = /вид(?:ел|елись|ели)|встреч|виделись|лично|\bseen\b|\bmet\b|\bmeet|in person|face to face/
const HELP = /^(?:привет|здравствуй|добрый\s+(?:день|вечер)|хай|что\s+ты\s+умеешь|помощь|help|как\s+(?:с\s+тобой|тобой)\s+работать|hi\b|hello|hey\b|what can you do|how do (?:i|you) use)/

const sentences = (text: string) => text.replace(/\s+/g, ' ').split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 2)
const cut = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/* ---------- people in the question ---------- */

/** Whom the question means: a name in any case form, in Latin letters, or "he/she" for the person from the previous answer. */
export function resolvePeople(text: string, ctx: ChatCtx): { people: Person[]; viaPronoun: boolean } {
  const pool = ctx.people.filter(p => !p.archived)
  const found = findMentioned(text, pool)
  // "Alexey", "Sasha": the name may be written differently from the card
  for (const w of text.split(/[^\p{L}]+/u).filter(x => x.length >= 3 && /^\p{Lu}/u.test(x))) {
    for (const p of pool) {
      if (!found.includes(p) && nameScore(w, p) >= 60) found.push(p)
    }
  }
  if (found.length) return { people: found, viaPronoun: false }
  if (PRONOUN.test(lower(text))) {
    const last = [...ctx.history].reverse().find(m => m.role === 'astra' && m.focus?.personId)
    const p = last?.focus?.personId ? pool.find(x => x.id === last.focus!.personId) : undefined
    if (p) return { people: [p], viaPronoun: true }
  }
  return { people: [], viaPronoun: false }
}

const mineOf = (p: Person, ints: Interaction[]) => ints.filter(i => i.personIds.includes(p.id)).sort((a, b) => b.date - a.date)

/* ---------- promises ---------- */

const THEIRS = /(?:мне\s+(?:пообещал\w*|обещал\w*)|(?:он|она|они)\s+(?:пообещал\w*|обещал\w*|пришлет|пришлёт|отправит|познакомит|скинет|поможет|вернется|вернётся|подготовит|сделает)|обещал\w*\s+(?:мне|прислать|познакомить|помочь|дать)\b)|(?:he|she|they)\s+(?:promised|will send|will introduce|will help|will get back|will prepare|will do|agreed to (?:send|introduce|help))|promised me|promised to (?:send|introduce|help|give) me/
const MINE = /(?:^|\s)(?:я\s+(?:пообещал\w*|обещал\w*)|(?:пообещал\w*|обещал\w*)\s+(?:ему|ей|им|что\s+я)|(?:я\s+)?(?:пришлю|отправлю|скину|познакомлю|подготовлю|сделаю|напишу|позвоню|вернусь|созвонюсь|узнаю|найду|организую|свожу|должен\s+(?:ему|ей|им)))|(?:^|\s)(?:i\s+(?:promised|will send|will introduce|will prepare|will do|will write|will call|will find|will organi[sz]e|owe)|promised (?:him|her|them)|i'?ll (?:send|introduce|prepare|write|call|find|organi[sz]e|get back))/
const AGREED = /договор\w*|условилис\w*|решили\s+что|согласовал\w*|\bagreed\b|\barranged\b|decided that|\bsettled\b/

function promiseKind(sentence: string, who: Person): ChatQuote['kind'] | null {
  const s = lower(sentence)
  const stemName = lower(who.firstName).slice(0, Math.max(3, lower(who.firstName).length - 1))
  const nameBefore = new RegExp(`${stemName}\\w*\\s+(?:пообещал\\w*|обещал\\w*|пришлет|пришлёт|отправит|познакомит|скинет|поможет|promised|will send|will introduce|will help)`).test(s)
  if (THEIRS.test(s) || nameBefore) return 'theirs'
  if (MINE.test(s)) return 'mine'
  if (AGREED.test(s)) return 'agreed'
  return null
}

function promisesAbout(p: Person, ctx: ChatCtx): ChatReply {
  const now = ctx.now ?? Date.now()
  const ints = mineOf(p, ctx.interactions)
  const quotes: ChatQuote[] = []
  const seen = new Set<string>()
  const push = (date: number, text: string, kind: ChatQuote['kind']) => {
    const k = lower(text)
    if (seen.has(k)) return
    seen.add(k)
    quotes.push({ personId: p.id, date, text: cut(text), kind })
  }
  for (const it of ints) {
    for (const sent of sentences(`${it.title ?? ''}. ${it.note ?? ''}`)) {
      const kind = promiseKind(sent, p)
      if (kind) push(it.date, sent, kind)
    }
  }
  for (const sent of sentences(p.notes ?? '')) { const kind = promiseKind(sent, p); if (kind) push(0, sent, kind) }
  const open = ctx.reminders.filter(r => r.personId === p.id && !r.done).sort((a, b) => a.dueAt - b.dueAt)
  const topics = p.topics.filter(topic2 => !topic2.done)

  const mine = quotes.filter(q => q.kind === 'mine')
  const theirs = quotes.filter(q => q.kind === 'theirs')
  const agreed = quotes.filter(q => q.kind === 'agreed')
  const lines: string[] = []
  if (open.length) lines.push(t('Open reminders: {list}.', { list: open.map(r => `${r.text} (${inDays(Math.round((r.dueAt - now) / 86_400_000))})`).join('; ') }))
  if (p.iCanHelp?.trim()) lines.push(t('How you can help: {text}.', { text: cut(p.iCanHelp.trim(), 140) }))
  if (topics.length) lines.push(t('Not yet discussed: {list}.', { list: topics.map(topic3 => topic3.text).join('; ') }))

  const total = quotes.length + open.length
  const head = total || lines.length
    ? `${fullName(p)}: ${[mine.length && t('your promises: {n}', { n: mine.length }), theirs.length && t('promised to you: {n}', { n: theirs.length }), agreed.length && t('agreements: {n}', { n: agreed.length }), open.length && t('reminders: {n}', { n: open.length })].filter(Boolean).join(', ') || t('nothing in the records, but there are plans')}.`
    : t('{name}: no promises, agreements or open reminders in the records.', { name: fullName(p) })
  return {
    intent: 'promises',
    text: [head, ...lines].join('\n'),
    cards: [{ id: p.id, reason: jobLine(p) || t('open the card') }],
    quotes: quotes.sort((a, b) => b.date - a.date).slice(0, 8),
    followUps: [t('What did we talk about last time?'), t('When did we meet?')],
    focus: { personId: p.id },
  }
}

/** All open promises and reminders across the network: "what I owe whom". */
function promisesAll(ctx: ChatCtx): ChatReply {
  const now = ctx.now ?? Date.now()
  const byId = new Map(ctx.people.map(p => [p.id, p]))
  const quotes: ChatQuote[] = []
  for (const it of ctx.interactions) {
    if (now - it.date > 120 * 86_400_000) continue
    for (const pid of it.personIds) {
      const p = byId.get(pid)
      if (!p || p.archived) continue
      for (const sent of sentences(`${it.title ?? ''}. ${it.note ?? ''}`)) if (promiseKind(sent, p) === 'mine') quotes.push({ personId: pid, date: it.date, text: cut(sent), kind: 'mine' })
    }
  }
  const open = ctx.reminders.filter(r => !r.done && r.personId && byId.has(r.personId)).sort((a, b) => a.dueAt - b.dueAt).slice(0, 6)
  const cards = [...new Map([...quotes.map(q => q.personId), ...open.map(r => r.personId!)].map(id => [id, id])).keys()].slice(0, 8)
  return {
    intent: 'promises',
    text: quotes.length || open.length
      ? t('Over the last four months the records hold {promises}, plus {reminders}.', {
        promises: tn(quotes.length, '{n} promise of yours', '{n} promises of yours'),
        reminders: tn(open.length, '{n} open reminder', '{n} open reminders'),
      })
      : t('No open promises or reminders found.'),
    cards: cards.map(id => ({ id, reason: [...open.filter(r => r.personId === id).map(r => r.text), ...quotes.filter(q => q.personId === id).map(q => q.text)][0] ?? '' })),
    quotes: quotes.sort((a, b) => b.date - a.date).slice(0, 8),
    followUps: [t('What did I promise each of them?')],
  }
}

/* ---------- conversation about a topic ---------- */

const TOPIC_STOP = new Set([
  ...STOP, 'говорили', 'говорил', 'говорила', 'обсуждали', 'обсуждал', 'разговор', 'разговаривали', 'рассказывал', 'рассказывала', 'писал', 'писали', 'сказал',
  'последний', 'последнем', 'раз', 'мы', 'нами', 'нашем', 'тогда', 'вчера', 'сегодня', 'давай', 'напомни', 'про', 'насчет', 'поводу', 'повод', 'теме', 'тема',
  'talked', 'talk', 'spoke', 'speak', 'discussed', 'discuss', 'conversation', 'told', 'said', 'wrote', 'last', 'time', 'remind', 'regarding', 'concerning',
  'topic', 'theme', 'yesterday', 'today', 'then', 'did', 'say', 'about', 'again', 'whats',
])

function topicStems(text: string, who: Person[]): string[] {
  const nameStems = new Set(who.flatMap(p => [p.firstName, p.lastName, p.nickname].filter(Boolean).map(n => stem(lower(n!)))))
  return words(text).filter(w => !TOPIC_STOP.has(w) && w.length >= 3).map(stem).filter(s => !nameStems.has(s) && !PRONOUN.test(s))
}

const hits = (sentence: string, terms: string[]) => {
  const fs = words(sentence).map(stem)
  return terms.filter(term => fs.some(s => s.startsWith(term) || (s.length >= 4 && term.startsWith(s)))).length
}

function topicTalk(p: Person, text: string, ctx: ChatCtx): ChatReply {
  const terms = topicStems(text, [p])
  const ints = mineOf(p, ctx.interactions)
  const found: Array<{ q: ChatQuote; score: number }> = []
  const add = (date: number, sent: string, score: number) => { if (score > 0) found.push({ q: { personId: p.id, date, text: cut(sent), kind: 'topic' }, score }) }
  if (terms.length) {
    for (const it of ints) for (const s of sentences(`${it.title ?? ''}. ${it.note ?? ''}`)) add(it.date, s, hits(s, terms))
    for (const s of sentences(p.notes ?? '')) add(0, s, hits(s, terms))
    for (const f of p.facts) add(0, f.text, hits(f.text, terms))
    for (const item of p.topics) add(0, item.text, hits(item.text, terms))
  }
  const top = found.sort((a, b) => b.score - a.score || b.q.date - a.q.date).slice(0, 5).map(x => x.q).sort((a, b) => b.date - a.date)
  const topic = terms.length ? `«${words(text).filter(w => !TOPIC_STOP.has(w) && terms.includes(stem(w))).join(' ')}»` : ''

  if (top.length) {
    return {
      intent: 'topic',
      text: `${fullName(p)}${topic ? ` · ${topic}` : ''}: ${tn(top.length, '{n} record on the topic.', '{n} records on the topic.')}`,
      cards: [{ id: p.id, reason: jobLine(p) || t('open the card') }],
      quotes: top,
      followUps: [t('What did I promise?'), t('When did we last meet?')],
      focus: { personId: p.id },
    }
  }
  // no topic, or no records about it: show the latest conversations
  const recent = ints.filter(i => i.note?.trim() || i.title?.trim()).slice(0, 3)
  return {
    intent: 'topic',
    text: terms.length
      ? `${t('{name}: nothing about {topic} in the records.', { name: fullName(p), topic })}${recent.length ? ` ${t("Here's what was in the latest conversations:")}` : ` ${t('No interaction records yet.')}`}`
      : `${fullName(p)}: ${recent.length ? t('latest conversations.') : t('no interaction records yet.')}`,
    cards: [{ id: p.id, reason: jobLine(p) || t('open the card') }],
    quotes: recent.map(i => ({ personId: p.id, date: i.date, text: cut([i.title, i.note].filter(Boolean).join('. ')), kind: 'topic' as const })),
    followUps: terms.length ? [t('What did I promise?')] : [t('What did I promise?'), t('When is the birthday?')],
    focus: { personId: p.id },
  }
}

/* ---------- when, birthday, dossier ---------- */

function lastContact(p: Person, ctx: ChatCtx): ChatReply {
  const now = ctx.now ?? Date.now()
  const ints = mineOf(p, ctx.interactions).filter(i => i.type !== 'note')
  const last = ints[0]
  const meet = ints.find(i => i.type === 'meeting' || i.type === 'event')
  const lines = [
    last ? `${t('Last contact: {date} ({ago} ago)', { date: dateLong(last.date), ago: agoShort(last.date, now) })}${last.title ? ` — ${last.title}` : ''}.` : p.lastContactAt ? t('Last contact: {date}.', { date: dateLong(p.lastContactAt) }) : t('No interaction records yet.'),
    meet && meet !== last ? t('Met in person: {date}.', { date: dateLong(meet.date) }) : meet ? t('That was an in-person meeting.') : '',
  ].filter(Boolean)
  return {
    intent: 'last', text: `${fullName(p)}\n${lines.join(' ')}`,
    cards: [{ id: p.id, reason: warmthOf(p, now).level === 'cold' ? t('the connection has cooled') : jobLine(p) || t('open the card') }],
    quotes: last?.note ? [{ personId: p.id, date: last.date, text: cut(last.note), kind: 'topic' }] : [],
    followUps: [t('What did we talk about?'), t('What did I promise?')], focus: { personId: p.id },
  }
}

function birthdayOf(p: Person, ctx: ChatCtx): ChatReply {
  const now = ctx.now ?? Date.now()
  const b = nextBirthday(p.birthday, now)
  return {
    intent: 'birthday',
    text: b ? `${t('{name}: birthday {date} — {when}', { name: fullName(p), date: dateLong(b.date, false), when: inDays(b.days) })}${b.turning ? `, ${t('turns {years}', { years: b.turning })}` : ''}.${p.giftIdeas ? ` ${t('Gift ideas: {ideas}.', { ideas: cut(p.giftIdeas, 100) })}` : ''}` : t('{name}: no birthday on the card.', { name: fullName(p) }),
    cards: [{ id: p.id, reason: b ? inDays(b.days) : t('add the date on the card') }], quotes: [], followUps: [t('What did I promise?')], focus: { personId: p.id },
  }
}

function about(p: Person, ctx: ChatCtx): ChatReply {
  const now = ctx.now ?? Date.now()
  const w = warmthOf(p, now)
  const rows = [
    jobLine(p), p.city && t('City: {v}', { v: p.city }), p.metPlace && t('Met: {v}', { v: p.metPlace }),
    p.lookingFor && t('Looking for now: {v}', { v: cut(p.lookingFor, 120) }), p.canHelpMe && t('Strong at: {v}', { v: cut(p.canHelpMe, 120) }),
    p.facts.length > 0 && t('Facts: {v}', { v: p.facts.slice(0, 3).map(f => f.text).join('; ') }), p.tags.length > 0 && t('Interests: {v}', { v: p.tags.slice(0, 6).join(', ') }),
    p.prefs?.allergies && t('Allergies: {v}', { v: p.prefs.allergies }), t('Connection: last contact {ago} ago', { ago: agoShort(p.lastContactAt, now) }),
  ].filter(Boolean)
  return {
    intent: 'about', text: `${fullName(p)}\n${rows.join('\n')}`, cards: [{ id: p.id, reason: w.level === 'hot' || w.level === 'warm' ? t('warm connection') : t('open the card') }],
    quotes: [], followUps: [t('What did I promise?'), t('What did we talk about last time?')], focus: { personId: p.id },
  }
}

/* ---------- selections: "which investors in Dubai haven't I seen in a while" ---------- */

const RECENCY_WORDS = new Set([
  'давно', 'видел', 'виделись', 'общался', 'общались', 'писал', 'созванивался', 'остыли', 'остыл', 'потерял', 'забыл', 'встречался', 'видела', 'встречались',
  'long', 'time', 'seen', 'met', 'talked', 'spoken', 'heard', 'contacted', 'written', 'touch', 'lost', 'forgot', 'cold', 'while', 'haven', 'havent', 'since', 'recently', 'meet',
])

export function parseFilters(text: string, ctx: ChatCtx, previous?: ChatFilters): ChatFilters | null {
  const query = lower(text)
  const tokens = words(text)
  const tokenStems = tokens.filter(w => !STOP.has(w) && !RECENCY_WORDS.has(w)).map(stem)
  const matchStem = (name: string) => {
    const ns = words(name).filter(w => !STOP.has(w) && w.length >= 3).map(stem)
    return ns.length > 0 && ns.some(n => tokenStems.some(s => s === n || (s.length >= 4 && n.length >= 4 && (s.startsWith(n) || n.startsWith(s)))))
  }
  const f: ChatFilters = {}
  const cities = [...new Set(ctx.people.map(p => p.city?.trim()).filter((c): c is string => !!c))]
  const city = cities.find(c => matchStem(c))
  if (city) f.city = city
  const circleIds = ctx.circles.filter(c => matchStem(c.name)).map(c => c.id)
  if (circleIds.length) f.circleIds = circleIds
  const coll = ctx.collections.find(c => matchStem(c.name))
  if (coll) f.collectionId = coll.id
  if (STALE.test(query)) { f.stale = true; if (MEETING_ONLY.test(query)) f.meetingsOnly = true }

  // words of a role and interests: everything that is not a city, a circle or a function word
  const known = new Set<string>([...(city ? words(city).map(stem) : []), ...ctx.circles.filter(c => circleIds.includes(c.id)).flatMap(c => words(c.name).map(stem)), ...(coll ? words(coll.name).map(stem) : [])])
  const extra = tokenStems.filter(s => s.length >= 3 && !known.has(s) && !TOPIC_STOP.has(s))
  const expanded = new Set<string>()
  for (const s of extra) {
    for (const [k, v] of Object.entries(ASK_SYN)) if (s.startsWith(k)) { expanded.add(s); for (const x of v) expanded.add(x) }
  }
  // the role is set only when the word really occurs in the cards: otherwise it is just a word of the question
  const corpus = ctx.people.map(p => lower([p.role, p.company, ...p.tags, p.canHelpMe, p.lookingFor].filter(Boolean).join(' ')))
  for (const s of extra) if (corpus.some(c => words(c).map(stem).some(x => x.startsWith(s) || (x.length >= 4 && s.startsWith(x))))) expanded.add(s)
  if (expanded.size) f.terms = [...expanded]

  // "and from Berlin?" is a refinement of the previous selection
  const hasOwn = f.city || f.circleIds || f.collectionId || f.terms
  if (previous && /^\s*(?:а|и|ну|тогда|and|what about|how about|then)\s/.test(query) && hasOwn) return { ...previous, ...f, stale: previous.stale || f.stale }
  if (!hasOwn && !f.stale) return null
  return f
}

const describeFilters = (f: ChatFilters, ctx: ChatCtx) => {
  const parts: string[] = []
  const circles = ctx.circles.filter(c => f.circleIds?.includes(c.id)).map(c => c.name)
  if (circles.length) parts.push(t('circle “{names}”', { names: circles.join(', ') }))
  const coll = ctx.collections.find(c => c.id === f.collectionId)
  if (coll) parts.push(t('list “{name}”', { name: coll.name }))
  if (f.terms?.length) parts.push(`«${f.terms.slice(0, 3).join(', ')}»`)
  if (f.city) parts.push(t('city “{city}”', { city: f.city }))
  return parts.join(' · ')
}

export function filterPeople(f: ChatFilters, ctx: ChatCtx) {
  const now = ctx.now ?? Date.now()
  const coll = ctx.collections.find(c => c.id === f.collectionId)
  const lastBy = new Map<ID, { any: number; meet: number }>()
  for (const it of ctx.interactions) {
    if (it.type === 'note') continue
    for (const pid of it.personIds) {
      const cur = lastBy.get(pid) ?? { any: 0, meet: 0 }
      cur.any = Math.max(cur.any, it.date)
      if (it.type === 'meeting' || it.type === 'event') cur.meet = Math.max(cur.meet, it.date)
      lastBy.set(pid, cur)
    }
  }
  const list = ctx.people.filter(p => !p.archived && !p.familyOf && p.lifeStatus !== 'irrelevant').filter(p => {
    if (f.city && lower(p.city ?? '') !== lower(f.city)) return false
    if (f.circleIds?.length && !p.circleIds.some(c => f.circleIds!.includes(c))) return false
    if (coll && !coll.personIds.includes(p.id)) return false
    if (f.terms?.length) {
      const fs = words([p.role, p.company, ...p.tags, p.canHelpMe, p.lookingFor, p.metPlace, ...p.facts.map(x => x.text)].filter(Boolean).join(' ')).map(stem)
      const circleWords = ctx.circles.filter(c => p.circleIds.includes(c.id)).flatMap(c => words(c.name).map(stem))
      if (!f.terms.some(term2 => [...fs, ...circleWords].some(s => s.startsWith(term2) || (s.length >= 4 && term2.startsWith(s))))) return false
    }
    return true
  }).map(p => {
    const l = lastBy.get(p.id)
    const at = (f.meetingsOnly ? l?.meet : l?.any) || (f.meetingsOnly ? 0 : p.lastContactAt) || 0
    return { p, at, days: at ? Math.floor((now - at) / 86_400_000) : null }
  })
  // "for a long time": those you are quietest with first; without it, the freshest
  return f.stale
    ? list.sort((a, b) => (a.at || 0) - (b.at || 0))
    : list.sort((a, b) => b.at - a.at)
}

function filterReply(f: ChatFilters, ctx: ChatCtx): ChatReply {
  const now = ctx.now ?? Date.now()
  let rows = filterPeople(f, ctx)
  // "a while" without a threshold: those whose pause is clearly longer than the rhythm, otherwise over 30 days
  if (f.stale) rows = rows.filter(r => r.days === null || r.days >= 30)
  const shown = rows.slice(0, 8)
  const what = describeFilters(f, ctx)
  return {
    intent: 'filter',
    text: shown.length
      ? `${what || t('Network')}: ${tn(rows.length, '{n} person', '{n} people')}${f.stale ? `, ${f.meetingsOnly ? t('longest without a meeting first') : t('longest without contact first')}` : ''}.`
      : `${what || t('Network')}: ${t('no matching people found')}${f.stale ? ` ${t('— or everyone is in touch')}` : ''}.`,
    cards: shown.map(({ p, at }) => ({
      id: p.id,
      reason: [jobLine(p), p.city, at ? (f.meetingsOnly ? t('met {ago} ago', { ago: agoShort(at, now) }) : t('in touch {ago} ago', { ago: agoShort(at, now) })) : t("haven't talked yet")].filter(Boolean).join(' · '),
    })),
    quotes: [],
    followUps: shown.length ? [t('Who should I write to first?'), t('What about another city?')] : [],
    focus: { filters: f },
  }
}

/* ---------- entry point ---------- */

export const helpReply = (): ChatReply => ({
  intent: 'help',
  text: t('I remember everything you wrote about people. Ask, for example:'),
  cards: [], quotes: [], followUps: chatExamples(),
})

export function localChat(text: string, ctx: ChatCtx): ChatReply {
  const query2 = lower(text)
  if (HELP.test(query2.trim()) && query2.trim().split(/\s+/).length <= 5) return helpReply()
  const { people } = resolvePeople(text, ctx)
  const prevFilters = [...ctx.history].reverse().find(m => m.role === 'astra' && m.focus?.filters)?.focus?.filters
  const main = people[0]

  if (main) {
    if (PROMISE.test(query2)) return promisesAbout(main, ctx)
    if (ASK_BDAY.test(query2)) return birthdayOf(main, ctx)
    if (ASK_LAST.test(query2) && !ASK_TOPIC.test(query2.replace(/когда.*последн/, ''))) return lastContact(main, ctx)
    if (ASK_ABOUT.test(query2)) return about(main, ctx)
    return topicTalk(main, text, ctx)
  }
  if (PROMISE.test(query2) && /что\s+я\s+(?:кому\s+)?(?:обещал|должен|должна)|кому\s+я\s+(?:что\s+)?(?:обещал|должен|должна)|мои\s+обещан|what (?:did )?i (?:promise|owe)|who do i owe|my (?:promises|commitments)|what (?:do )?i owe/.test(query2)) return promisesAll(ctx)

  const filters = parseFilters(text, ctx, prevFilters)
  if (filters) return filterReply(filters, ctx)

  // last resort: semantic search over the network
  const r = localAsk(text, ctx.people, ctx.interactions, ctx.now)
  return { intent: 'search', text: r.answer, cards: r.people, quotes: [], followUps: r.follow_ups }
}
