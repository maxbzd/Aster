import { db } from '@/data/db'
import { addReminder, blankPerson, logInteraction, savePerson } from '@/data/actions'
import type { ChatMessage, Closeness, Interaction, Person } from '@/data/types'
import { DAY, fromISODate, fullName, jobLine, lcFirst, toISODate } from '@/lib/format'
import { activeAi, astraJSON, astraWebText, friendlyError } from './client'
import { dossier, memoryBlock, namesIndex, networkIndex, todayLine } from './context'
import { prompts } from './prompts'
import type { AskResult, Brief, CapturePlan, Drafts, IntroDrafts, NoteSuggestions } from './schemas'
import { localChat, resolvePeople, type ChatReply } from './local/chat'
import { localCapture, localNoteSuggest } from './local/parse'
import { localBrief } from './local/brief'
import { localAsk } from './local/ask'
import { localDrafts } from './local/drafts'
import { computeOccasions, topOccasionByPerson, type Occasion } from './local/occasions'
import { localMatches, type MatchPair } from './local/matches'
import { localLeadDrafts } from './local/reserve'
import { localWeekly, weekKey, type WeeklyData } from './local/weekly'
import { uid } from '@/data/db'
import { getLocale, t } from '@/i18n'
const schemas = () => import('./schemas')

export type Source = 'ai' | 'local'
export interface Result<T> { data: T; source: Source; error?: string }

/* ---------- cache of model answers ---------- */

async function cached<T>(key: string, maxAgeMs: number, make: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    const hit = await db.aiCache.get(key)
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.value as T
  }
  const value = await make()
  await db.aiCache.put({ key, at: Date.now(), value })
  return value
}
export const clearAiCache = (prefix: string) => db.aiCache.where('key').startsWith(prefix).delete()

async function snapshot() {
  const [people, circles, interactions, reminders, settings, intros] = await Promise.all([
    db.people.toArray(), db.circles.orderBy('order').toArray(), db.interactions.toArray(), db.reminders.toArray(), db.settings.get('me'), db.intros.toArray(),
  ])
  return { people: people.filter(p => !p.archived), circles, interactions, reminders, settings, intros }
}

const dismissedSet = (intros: { aId: string; bId: string; status: string }[]) =>
  new Set(intros.filter(i => i.status !== 'suggested').map(i => `${i.aId}:${i.bId}`))

/* ---------- 🎙 Parsing dictation ---------- */

function sanitizePlan(plan: CapturePlan, people: Person[]): CapturePlan {
  const ids = new Set(people.map(p => p.id))
  return {
    ...plan,
    people: plan.people.map(d => ({
      ...d,
      existing_id: d.existing_id && ids.has(d.existing_id) ? d.existing_id : null,
      introduced_by_id: d.introduced_by_id && ids.has(d.introduced_by_id) ? d.introduced_by_id : null,
    })),
    reminders: plan.reminders.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.due_date)),
  }
}

export async function astraCapture(text: string, images: string[] = [], signal?: AbortSignal): Promise<Result<CapturePlan>> {
  const { people } = await snapshot()
  const ai = await activeAi()
  if (!ai) return { data: localCapture(text, people), source: 'local' }
  try {
    const content = [
      ...images.map(img => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: img.split(',')[1] } })),
      { type: 'text' as const, text: t("{todayLine}\n\nUSER'S NOTE:\n{v}", { todayLine: todayLine(), v: text.trim() || t('(photo only — extract the data from the image)') }) },
    ]
    const data = await astraJSON(ai, { task: 'capture', schema: () => schemas().then(m => m.CaptureSchema), system: prompts().capture, context: namesIndex(people), content, effort: 'medium', signal })
    return { data: sanitizePlan(data, people), source: 'ai' }
  } catch (e) {
    return { data: localCapture(text, people), source: 'local', error: friendlyError(e).message }
  }
}

const uniq = <T,>(a: T[]) => [...new Set(a)]
const joinText = (a?: string, b?: string | null) => (!b ? a : !a ? b : a.toLowerCase().includes(b.toLowerCase()) ? a : `${a}; ${b}`)

export interface ApplyOptions { metAt?: string; metPlace?: string; circleIds?: string[]; closeness?: Closeness; photos?: Record<string, string>; interactionDate?: number }

/** Apply a parsed plan to the database. Returns the ids of created/updated people by ref. */
export async function applyPlan(plan: CapturePlan, opt: ApplyOptions = {}) {
  const refToId: Record<string, string> = {}
  let created = 0
  let updated = 0
  for (const d of plan.people) {
    const existing = d.existing_id ? await db.people.get(d.existing_id) : undefined
    const channels = d.channels.filter(c => c.value.trim())
    if (existing) {
      const p: Person = {
        ...existing,
        role: existing.role || d.role || undefined,
        company: existing.company || d.company || undefined,
        city: d.city || existing.city,
        family: joinText(existing.family, d.family),
        facts: [...existing.facts, ...d.facts.filter(f => !existing.facts.some(x => x.text.toLowerCase() === f.toLowerCase())).map(text => ({ icon: 'sparkle' as const, text }))],
        tags: uniq([...existing.tags, ...d.interests]),
        lookingFor: d.looking_for || existing.lookingFor,
        canHelpMe: joinText(existing.canHelpMe, d.can_help),
        iCanHelp: joinText(existing.iCanHelp, d.i_can_help),
        channels: [...existing.channels, ...channels.filter(c => !existing.channels.some(x => x.value === c.value))],
        birthday: existing.birthday || d.birthday || undefined,
        topics: [...existing.topics, ...d.topics.filter(topic => !existing.topics.some(x => x.text === topic)).map(text => ({ id: uid(), text, done: false }))],
        giftIdeas: joinText(existing.giftIdeas, d.gift_ideas),
        introducedBy: existing.introducedBy || d.introduced_by_id || undefined,
        photo: existing.photo || opt.photos?.[d.ref],
      }
      await savePerson(p)
      refToId[d.ref] = p.id
      updated++
    } else {
      const p = blankPerson({
        firstName: d.first_name.trim() || t('No name'),
        lastName: d.last_name?.trim() || undefined,
        role: d.role || undefined,
        company: d.company || undefined,
        city: d.city || undefined,
        family: d.family || undefined,
        facts: d.facts.map(text => ({ icon: 'sparkle' as const, text })),
        tags: uniq(d.interests),
        lookingFor: d.looking_for || undefined,
        canHelpMe: d.can_help || undefined,
        iCanHelp: d.i_can_help || undefined,
        channels,
        birthday: d.birthday || undefined,
        metAt: opt.metAt ?? toISODate(Date.now()),
        metPlace: d.met_place || opt.metPlace || undefined,
        introducedBy: d.introduced_by_id || undefined,
        topics: d.topics.map(text => ({ id: uid(), text, done: false })),
        giftIdeas: d.gift_ideas || undefined,
        closeness: opt.closeness ?? 3,
        circleIds: opt.circleIds ?? [],
        photo: opt.photos?.[d.ref],
      })
      await savePerson(p)
      refToId[d.ref] = p.id
      created++
    }
  }
  if (plan.interaction) {
    const ids = plan.interaction.person_refs.map(r => refToId[r]).filter(Boolean)
    if (ids.length) {
      await logInteraction({
        personIds: ids, type: plan.interaction.type, date: opt.interactionDate ?? Date.now(),
        title: plan.interaction.title, note: plan.interaction.summary, place: plan.interaction.place ?? undefined,
      })
    }
  }
  for (const r of plan.reminders) {
    await addReminder({ personId: r.person_ref ? refToId[r.person_ref] : undefined, text: r.text, dueAt: fromISODate(r.due_date) + 10 * 3600_000 })
  }
  return { refToId, created, updated }
}

/* ---------- 🗂 Pre-meeting brief ---------- */

export async function astraBrief(personId: string, force = false): Promise<Result<Brief>> {
  const { people, interactions, reminders, intros, settings } = await snapshot()
  const p = await db.people.get(personId)
  if (!p) throw new Error(t('Person not found'))
  const byId = new Map(people.map(x => [x.id, x]))
  const ints = interactions.filter(i => i.personIds.includes(p.id)).sort((a, b) => b.date - a.date)
  const rems = reminders.filter(r => r.personId === p.id)
  const matches = localMatches(people, dismissedSet(intros))
  const local = localBrief(p, ints, rems, byId, matches)
  const ai = await activeAi()
  if (!ai) return { data: local, source: 'local' }
  try {
    const key = `brief:${p.id}:${p.updatedAt}:${ints.length}:${rems.filter(r => !r.done).length}:${ai.model}`
    const data = await cached(key, 7 * DAY, () =>
      astraJSON(ai, {
        task: 'brief', schema: () => schemas().then(m => m.BriefSchema), system: prompts().brief, effort: 'medium',
        context: networkIndex(people, [], Date.now()),
        content: t('{todayLine}\nUser: {v}\n\n{dossier}\n\nPrepare a brief for the meeting with this person.', { todayLine: todayLine(), v: settings?.name || t('not specified'), dossier: dossier(p, ints, rems, byId, ai.shareNotes) }),
      }), force)
    return { data, source: 'ai' }
  } catch (e) {
    return { data: local, source: 'local', error: friendlyError(e).message }
  }
}

/* ---------- 🔍 Ask the network ---------- */

export async function astraAsk(question: string, signal?: AbortSignal): Promise<Result<AskResult>> {
  const { people, circles, interactions } = await snapshot()
  const local = () => localAsk(question, people, interactions)
  const ai = await activeAi()
  if (!ai) return { data: local(), source: 'local' }
  try {
    const data = await astraJSON(ai, {
      task: 'ask', schema: () => schemas().then(m => m.AskSchema), system: prompts().ask, effort: 'medium', signal,
      context: networkIndex(people, circles),
      content: t('{todayLine}\n\nQUESTION: {question}', { todayLine: todayLine(), question }),
    })
    const ids = new Set(people.map(p => p.id))
    return { data: { ...data, people: data.people.filter(x => ids.has(x.id)) }, source: 'ai' }
  } catch (e) {
    return { data: local(), source: 'local', error: friendlyError(e).message }
  }
}

/* ---------- 💬 Chat with memory ---------- */

export async function astraChat(question: string, history: ChatMessage[], signal?: AbortSignal): Promise<Result<ChatReply>> {
  const [snap, collections] = await Promise.all([snapshot(), db.collections.toArray()])
  const { people, circles, interactions, reminders } = snap
  const ctx = { people, interactions, reminders, circles, collections, history }
  const local = () => localChat(question, ctx)
  const ai = await activeAi()
  if (!ai) return { data: local(), source: 'local' }
  try {
    const mentioned = resolvePeople(question, ctx).people.map(p => p.id)
    const recent = history.slice(-8).map(m => `${m.role === 'user' ? t('User') : t('Astra')}: ${m.text}`).join('\n')
    const data = await astraJSON(ai, {
      task: 'chat', schema: () => schemas().then(m => m.ChatSchema), system: prompts().chat, effort: 'medium', signal, maxTokens: 6000,
      context: `${networkIndex(people, circles)}

${memoryBlock(interactions, people, mentioned, ai.shareNotes)}`,
      content: t('{todayLine}\n{v}\nQUESTION: {question}', { todayLine: todayLine(), v: recent ? t('\nCONVERSATION SO FAR:\n{recent}\n', { recent }) : '', question }),
    })
    const ids = new Set(people.map(p => p.id))
    const day = (s: string | null) => (s ? fromISODate(s) : 0)
    return {
      source: 'ai',
      data: {
        intent: 'search',
        text: data.answer,
        cards: data.people.filter(x => ids.has(x.id)),
        quotes: data.quotes.filter(q => ids.has(q.person_id)).map(q => ({ personId: q.person_id, date: day(q.date), text: q.text, kind: q.kind })),
        followUps: data.follow_ups.slice(0, 3),
        focus: data.focus_person_id && ids.has(data.focus_person_id) ? { personId: data.focus_person_id } : undefined,
      },
    }
  } catch (e) {
    return { data: local(), source: 'local', error: friendlyError(e).message }
  }
}

/* ---------- 🧠 Suggestions from notes ---------- */

export function quickNoteSuggestions(text: string, person: Person, people: Person[]) {
  return localNoteSuggest(text, person, people)
}

export async function astraNoteSuggest(text: string, personId: string): Promise<Result<NoteSuggestions>> {
  const { people, interactions, reminders } = await snapshot()
  const p = people.find(x => x.id === personId)
  if (!p) return { data: { items: [] }, source: 'local' }
  const ai = await activeAi()
  if (!ai) return { data: localNoteSuggest(text, p, people), source: 'local' }
  try {
    const byId = new Map(people.map(x => [x.id, x]))
    const data = await astraJSON(ai, {
      task: 'note', schema: () => schemas().then(m => m.NoteSuggestSchema), system: prompts().note, effort: 'low', maxTokens: 4000,
      content: t('{todayLine}\n\nALREADY SAVED:\n{dossier}\n\nNEW NOTE:\n{text}', { todayLine: todayLine(), dossier: dossier(p, interactions.filter(i => i.personIds.includes(p.id)).slice(0, 3), reminders.filter(r => r.personId === p.id), byId, false), text }),
    })
    return { data, source: 'ai' }
  } catch (e) {
    return { data: localNoteSuggest(text, p, people), source: 'local', error: friendlyError(e).message }
  }
}

/* ---------- ⚡ Reasons and drafts ---------- */

export function occasionsFrom(people: Person[], interactions: Interaction[], reminders: { personId?: string; text: string; done: boolean; dueAt: number; id: string; createdAt: number }[], matches: MatchPair[], now = Date.now()) {
  const list = computeOccasions(people, interactions, reminders, matches, now)
  return { list, byPerson: topOccasionByPerson(list) }
}

/** The person's language of communication, when it differs from the interface language: tells the model which language to write in. */
const LANGUAGE_NAMES: Record<string, string> = { ru: 'Russian', en: 'English', es: 'Spanish', de: 'German', fr: 'French', pt: 'Portuguese', uk: 'Ukrainian' }
const languageLine = (p: Person) => {
  const lang = p.prefs?.language
  return lang && LANGUAGE_NAMES[lang] && lang !== getLocale() ? `Write all three messages in ${LANGUAGE_NAMES[lang]}.\n\n` : ''
}

export async function astraDrafts(personId: string, occasion: Occasion | null, force = false): Promise<Result<Drafts>> {
  const { people, interactions, reminders, settings } = await snapshot()
  const p = people.find(x => x.id === personId)
  if (!p) throw new Error(t('Person not found'))
  const ints = interactions.filter(i => i.personIds.includes(p.id)).sort((a, b) => b.date - a.date)
  const me = settings?.name?.split(' ')[0] ?? ''
  const local = localDrafts(p, occasion, me, people, ints.find(i => i.type !== 'note'))
  const ai = await activeAi()
  if (!ai) return { data: local, source: 'local' }
  try {
    const byId = new Map(people.map(x => [x.id, x]))
    const helper = occasion?.data.helperId ? byId.get(occasion.data.helperId) : undefined
    const key = `drafts:${p.id}:${occasion?.id ?? 'none'}:${toISODate(Date.now())}:${ai.model}`
    const data = await cached(key, DAY, () =>
      astraJSON(ai, {
        task: 'drafts', schema: () => schemas().then(m => m.DraftsSchema), system: prompts().draft, effort: 'low', maxTokens: 4000,
        content: languageLine(p) + t('{todayLine}\nSender: {v}\n\n{dossier}\n\nOCCASION: {v2}{v3}{v4}', { todayLine: todayLine(), v: settings?.name || t('the user'), dossier: dossier(p, ints, reminders.filter(r => r.personId === p.id), byId, ai.shareNotes), v2: occasion ? `${occasion.title} — ${occasion.detail}` : t("just haven't been in touch for a while"), v3: helper ? t('\nWho to suggest for an introduction: {name} ({name2}; {v})', { name: fullName(helper), name2: jobLine(helper), v: helper.canHelpMe ?? '' }) : '', v4: occasion?.data.news ? t('\nNews: {news}', { news: occasion.data.news }) : '' }),
      }), force)
    return { data, source: 'ai' }
  } catch (e) {
    return { data: local, source: 'local', error: friendlyError(e).message }
  }
}

/** The first message to a person from the reserve: "how to start if I do not know what to write". */
export async function astraLeadDrafts(leadId: string, force = false): Promise<Result<Drafts>> {
  const lead = await db.leads.get(leadId)
  if (!lead) throw new Error(t('Contact not found'))
  const settings = await db.settings.get('me')
  const me = settings?.name?.split(' ')[0] ?? ''
  const local = localLeadDrafts(lead, me)
  const ai = await activeAi()
  if (!ai) return { data: local, source: 'local' }
  try {
    const key = `leaddrafts:${lead.id}:${lead.updatedAt}:${ai.model}`
    const card = [
      t('Name: {name}', { name: fullName(lead) }), lead.role && t('Position: {role}', { role: lead.role }), lead.company && t('Company: {company}', { company: lead.company }), lead.city && t('City: {city}', { city: lead.city }),
      lead.why && t('Why valuable: {why}', { why: lead.why }), lead.source && t('Where from: {source}', { source: lead.source }), lead.tags.length && t('Tags: {v}', { v: lead.tags.join(', ') }),
      ai.shareNotes && lead.notes && t("User's note: {notes}", { notes: lead.notes }),
    ].filter(Boolean).join('\n')
    const data = await cached(key, 7 * DAY, () =>
      astraJSON(ai, {
        task: 'leaddrafts', schema: () => schemas().then(m => m.DraftsSchema), system: prompts().leadDraft, effort: 'low', maxTokens: 4000,
        content: t('{todayLine}\nSender: {v}\n\nCARD OF A PERSON FROM THE RESERVE:\n{card}', { todayLine: todayLine(), v: settings?.name || t('the user'), card }),
      }), force)
    return { data, source: 'ai' }
  } catch (e) {
    return { data: local, source: 'local', error: friendlyError(e).message }
  }
}

/** A fresh piece of news about a person/company through web search (only with a model and permission). */
export async function astraNews(personId: string): Promise<string | null> {
  const ai = await activeAi()
  if (!ai?.webSearch) return null
  const p = await db.people.get(personId)
  if (!p || (!p.company && !p.lastName)) return null
  try {
    const text = await cached(`news:${p.id}:${weekKey()}`, 7 * DAY, () =>
      astraWebText(ai, 'news', prompts().news, t('{todayLine}\nPerson: {name}{v}{v2}{v3}.', { todayLine: todayLine(), name: fullName(p), v: p.role ? `, ${p.role}` : '', v2: p.company ? t(' at {company}', { company: p.company }) : '', v3: p.city ? `, ${p.city}` : '' })))
    return !text || /^(?:нет|none|no)\.?$/i.test(text.trim()) ? null : text
  } catch {
    return null
  }
}

/* ---------- 🤝 Matchmaker ---------- */

export async function astraMatches(force = false): Promise<Result<MatchPair[]>> {
  const { people, circles, intros } = await snapshot()
  const excluded = dismissedSet(intros)
  const local = localMatches(people, excluded)
  const ai = await activeAi()
  if (!ai) return { data: local, source: 'local' }
  try {
    const byId = new Map(people.map(x => [x.id, x]))
    const key = `matches:${toISODate(Date.now())}:${people.length}:${intros.length}:${ai.model}`
    const data = await cached(key, DAY, () =>
      astraJSON(ai, {
        task: 'matches', schema: () => schemas().then(m => m.MatchesSchema), system: prompts().match, effort: 'high',
        context: networkIndex(people, circles),
        content: t("{todayLine}\nPairs already handled (don't suggest): {v}\n\nFind the best pairs for an introduction.", { todayLine: todayLine(), v: [...excluded].join(', ') || t('none') }),
      }), force)
    const pairs: MatchPair[] = data.matches
      .map(m => ({ a: byId.get(m.a_id)!, b: byId.get(m.b_id)!, reason: m.reason, value: m.value, score: m.score }))
      .filter(m => m.a && m.b && m.a.id !== m.b.id && !excluded.has(`${m.a.id}:${m.b.id}`) && !excluded.has(`${m.b.id}:${m.a.id}`))
      .filter((m, i, all) => all.findIndex(o => [o.a.id, o.b.id].sort().join() === [m.a.id, m.b.id].sort().join()) === i)
    return { data: pairs.length ? pairs : local, source: pairs.length ? 'ai' : 'local' }
  } catch (e) {
    return { data: local, source: 'local', error: friendlyError(e).message }
  }
}

export function localIntroDrafts(m: MatchPair): IntroDrafts {
  const A = m.a, B = m.b
  const aj = jobLine(A), bj = jobLine(B)
  const need = lcFirst(A.lookingFor)
  return {
    to_a: t("Hi {firstName}! I remember your request — “{need}”. There's someone who can help: {name}{v}.{v2} Shall I introduce you? If yes, I'll set up a group chat.", { firstName: A.firstName, need, name: fullName(B), v: bj ? ` (${bj})` : '', v2: B.canHelpMe ? t(' Strengths: {lcFirst}.', { lcFirst: lcFirst(B.canHelpMe) }) : '' }),
    to_b: t("Hi {firstName}! I'd like to introduce you to someone: {name}{v}. Currently looking for: “{need}” — I think you two will have plenty to talk about. Mind if I set up a group chat?", { firstName: B.firstName, name: fullName(A), v: aj ? ` (${aj})` : '', need }),
    group: t('Meet each other! {firstName}{v}, currently looking for: “{need}”. {firstName2}{v2}{v3}. I think you have a lot to discuss — over to you 🙂', { firstName: A.firstName, v: aj ? ` — ${aj}` : '', need, firstName2: B.firstName, v2: bj ? ` — ${bj}` : '', v3: B.canHelpMe ? t(', strengths: {lcFirst}', { lcFirst: lcFirst(B.canHelpMe) }) : '' }),
  }
}

export async function astraIntroDrafts(m: MatchPair): Promise<Result<IntroDrafts>> {
  const local = localIntroDrafts(m)
  const ai = await activeAi()
  if (!ai) return { data: local, source: 'local' }
  try {
    const { people, interactions, reminders, settings } = await snapshot()
    const byId = new Map(people.map(x => [x.id, x]))
    const d = (p: Person) => dossier(p, interactions.filter(i => i.personIds.includes(p.id)).slice(0, 4), reminders.filter(r => r.personId === p.id), byId, ai.shareNotes)
    const data = await cached(`intro:${m.a.id}:${m.b.id}:${ai.model}`, 7 * DAY, () =>
      astraJSON(ai, {
        task: 'intro', schema: () => schemas().then(m => m.IntroDraftsSchema), system: prompts().intro, effort: 'low', maxTokens: 4000,
        content: t('Sender: {v}\nReason for the introduction: {reason}\n\nFIRST (to_a):\n{d}\n\nSECOND (to_b):\n{d2}', { v: settings?.name || t('the user'), reason: m.reason, d: d(m.a), d2: d(m.b) }),
      }))
    return { data, source: 'ai' }
  } catch (e) {
    return { data: local, source: 'local', error: friendlyError(e).message }
  }
}

export async function setIntroStatus(m: { a: Person; b: Person; reason: string }, status: 'asked' | 'done' | 'dismissed') {
  const existing = await db.intros.where('aId').equals(m.a.id).and(i => i.bId === m.b.id).first()
  const now = Date.now()
  if (existing) await db.intros.update(existing.id, { status, updatedAt: now })
  else await db.intros.put({ id: uid(), aId: m.a.id, bId: m.b.id, reason: m.reason, status, createdAt: now, updatedAt: now })
  if (status === 'done' && existing?.status !== 'done') {
    // the introduction happened (pressing again does not create more "I helped" records): a link between them plus "I helped" for both
    const [a, b] = await Promise.all([db.people.get(m.a.id), db.people.get(m.b.id)])
    if (a && b) {
      await db.people.update(a.id, { links: [...a.links.filter(l => l.personId !== b.id), { personId: b.id, label: t('introduction through me') }] })
      await db.people.update(b.id, { links: [...b.links.filter(l => l.personId !== a.id), { personId: a.id, label: t('introduction through me') }] })
      await logInteraction({ personIds: [a.id, b.id], type: 'favor_given', date: now, title: t('Introduction: {firstName} and {firstName2}', { firstName: a.firstName, firstName2: b.firstName }), note: m.reason })
    }
  }
}

/* ---------- 🪐 Weekly brief ---------- */

export async function astraWeekly(force = false): Promise<WeeklyData> {
  const { people, circles, interactions, reminders, intros } = await snapshot()
  const matches = localMatches(people, dismissedSet(intros))
  const { byPerson } = occasionsFrom(people, interactions, reminders, matches)
  const local = localWeekly(people, interactions, reminders, byPerson, matches)
  const ai = await activeAi()
  if (!ai) return local
  try {
    const byId = new Map(people.map(x => [x.id, x]))
    const facts = [
      t('Week: {range}. Network pulse: {health}. Contacts in 7 days: {contacts} (usually {avg}). New people: {newPeople}.', { range: local.range, health: local.stats.health, contacts: local.stats.contacts, avg: local.stats.avg, newPeople: local.stats.newPeople }),
      local.birthdays.length && t('Birthdays: {v}', { v: local.birthdays.map(x => t('{name} (id:{id}) in {days} d.{v}', { name: fullName(x.p), id: x.p.id, days: x.b.days, v: x.p.giftIdeas ? t(', gift ideas: {giftIdeas}', { giftIdeas: x.p.giftIdeas }) : '' })).join('; ') }),
      local.cooling.length && t('Close ones cooling: {v}', { v: local.cooling.map(x => t('{name} (id:{id}) {days} d.{v}', { name: fullName(x.p), id: x.p.id, days: x.days, v: x.o ? t(', reason: {title} — {detail}', { title: x.o.title, detail: x.o.detail }) : '' })).join('; ') }),
      local.intros.length && t('Possible introductions: {v}', { v: local.intros.map(m => `${m.a.firstName} (id:${m.a.id}) × ${m.b.firstName}: ${m.reason}`).join('; ') }),
      local.promises.length && t('Promises: {v}', { v: local.promises.map(r => `${r.text}${r.personId && byId.get(r.personId) ? ` (${byId.get(r.personId)!.firstName})` : ''}`).join('; ') }),
    ].filter(Boolean).join('\n')
    const ai2 = await cached(`weekly:${local.key}:${ai.model}`, 2 * DAY, () =>
      astraJSON(ai, {
        task: 'weekly', schema: () => schemas().then(m => m.WeeklySchema), system: prompts().weekly, effort: 'medium',
        context: networkIndex(people, circles),
        content: t('{todayLine}\n\nFACTS OF THE WEEK:\n{facts}', { todayLine: todayLine(), facts }),
      }), force)
    const ids = new Set(people.map(p => p.id))
    return { ...local, headline: ai2.headline, narrative: ai2.narrative, priorities: ai2.priorities.filter(p => ids.has(p.person_id)).map(p => ({ personId: p.person_id, action: p.action, why: p.why })), source: 'ai' }
  } catch {
    return local
  }
}

/* ---------- Connection check ---------- */

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const ai = await activeAi()
  if (!ai) return { ok: false, message: t("Astra isn't connected") }
  try {
    const r = await astraJSON(ai, { task: 'test', schema: () => import('zod/v4').then(z => z.object({ ok: z.boolean(), greeting: z.string() })), system: t('You are Astra. Answer ok=true and a short greeting in English (up to 6 words).'), content: t('Connection check'), effort: 'low', maxTokens: 2000 })
    return { ok: r.ok, message: r.greeting }
  } catch (e) {
    return { ok: false, message: friendlyError(e).message }
  }
}

