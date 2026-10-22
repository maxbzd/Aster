import type { Lead, Person } from '@/data/types'
import type { Drafts } from '../schemas'
import { fullName, jobLine, lcFirst } from '@/lib/format'
import { leadText } from '@/data/leadParse'
import { ASK_SYN } from './ask'
import { expand } from './matches'
import { getLocale, t } from '@/i18n'
import { lower, stem, stems, words } from './text'

/** Reserve search: by meaning, with synonyms and weighted fields. Everything on the device. */

interface Field { text: string; w: number; name: string }

const fieldsOf = (l: Lead): Field[] => [
  { text: l.role ?? '', w: 3, name: t('Position') },
  { text: l.why ?? '', w: 3, name: t('Why valuable') },
  { text: l.tags.join(' '), w: 2.5, name: t('Tags') },
  { text: l.company ?? '', w: 2, name: t('Company') },
  { text: l.city ?? '', w: 2.5, name: t('City') },
  { text: l.source ?? '', w: 1, name: t('Source') },
  { text: l.notes ?? '', w: 1, name: t('Note') },
]

const hit = (n: string, s: string) => s === n || (n.length >= 3 && s.startsWith(n)) || (s.length >= 3 && n.startsWith(s))

export function expandNeed(query: string) {
  const base = stems(query)
  const out = new Set(expand(base))
  for (const s of base) for (const [k, v] of Object.entries(ASK_SYN)) if (s.startsWith(k)) { for (const x of v) out.add(x) }
  return [...out]
}

export interface LeadHit { lead: Lead; score: number; reason: string }

// word stems of a card are computed once and reused for all queries (thousands of cards, dozens of queries)
const stemCache = new WeakMap<Lead, { f: Field; fs: string[] }[]>()
const indexed = (l: Lead) => {
  let v = stemCache.get(l)
  if (!v) { v = fieldsOf(l).filter(f => f.text).map(f => ({ f, fs: words(f.text).map(stem) })); stemCache.set(l, v) }
  return v
}

export function scoreLead(need: string[], l: Lead): { score: number; reason: string } {
  let score = 0
  let best: { gain: number; name: string; text: string } | null = null
  for (const { f, fs } of indexed(l)) {
    const hits = need.filter(n => n.length >= 2 && fs.some(s => hit(n, s)))
    const gain = hits.length * f.w
    if (gain > 0) { score += gain; if (!best || gain > best.gain) best = { gain, name: f.name, text: f.text } }
  }
  if (score > 0 && l.star) score += 0.5
  const text = best ? (best.text.length > 70 ? `${best.text.slice(0, 68)}…` : best.text) : ''
  return { score, reason: best ? `${best.name}: ${text}` : '' }
}

/** A question in plain language → the best cards from the reserve. */
export function askReserve(q: string, leads: Lead[], limit = 6): LeadHit[] {
  const need = expandNeed(q)
  if (!need.length) return []
  return leads
    .map(lead => ({ lead, ...scoreLead(need, lead) }))
    .filter(x => x.score >= 2.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** A simple string filter: every query word must occur (stem-aware). */
export function filterLeads(q: string, leads: Lead[]): Lead[] {
  const toks = words(q)
  if (!toks.length) return leads
  return leads.filter(l => {
    const h = lower(leadText(l))
    return toks.every(tok => h.includes(tok) || (tok.length >= 4 && h.includes(stem(tok))))
  })
}

export interface ReserveMatch { person: Person; lead: Lead; reason: string; score: number }

/** Who in the network is looking for something — and who in the reserve already has it. */
export function reserveMatches(people: Person[], leads: Lead[], limit = 6): ReserveMatch[] {
  if (!leads.length) return []
  const used = new Set<string>()
  const out: ReserveMatch[] = []
  const seekers = people.filter(p => !p.archived && p.lookingFor)
  const all = seekers.flatMap(person => {
    const need = expandNeed(person.lookingFor!)
    // if the person fits their own request, they are looking for clients or teams, not a colleague — such matches are noise
    const self: Lead = { id: person.id, createdAt: 0, updatedAt: 0, firstName: person.firstName, role: person.role, company: person.company, why: person.canHelpMe, tags: person.tags, channels: [] }
    if (scoreLead(need, self).score >= 4) return []
    return leads.map(lead => ({ person, lead, ...scoreLead(need, lead) })).filter(x => x.score >= 4).sort((a, b) => b.score - a.score).slice(0, 1)
  })
  for (const m of all.sort((a, b) => b.score - a.score)) {
    if (used.has(m.lead.id) || out.some(o => o.person.id === m.person.id)) continue
    used.add(m.lead.id)
    out.push(m)
    if (out.length >= limit) break
  }
  return out
}

/** A first message to a stranger: formal register, no gender-dependent words. */
export function localLeadDrafts(l: Lead, me: string): Drafts {
  return getLocale() === 'ru' ? ruLeadDrafts(l, me) : enLeadDrafts(l, me)
}

function enLeadDrafts(l: Lead, me: string): Drafts {
  const n = l.firstName
  const who = me ? `My name is ${me}.` : ''
  const src = l.source ? `I have your contact from “${l.source}”.` : ''
  const role = l.role ? lcFirst(l.role) : ''
  const about = role && l.company ? `Your work as ${role} at ${l.company} caught my attention.`
    : role ? `Your work as ${role} caught my attention.`
    : l.company ? `I know you are connected with ${l.company}.`
    : l.tags[0] ? `The topic “${l.tags[0]}”, which you work in, is very close to me.` : ''
  const join = (...p: string[]) => p.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  return {
    short: join(`Hi ${n}!`, who, src, "I'd love to get acquainted — may I write you a few words?"),
    warm: join(`Hi ${n}!`, who, src, about, "What you do really resonates with me and I'd simply like to get acquainted — no rush and no sales pitch. If you're interested, I'll tell you about myself in a couple of sentences."),
    business: join(`Hi ${n}!`, who, src, about, "I suggest a short 15-minute call: to introduce myself and understand where we could be useful to each other. When would suit you?"),
  }
}

function ruLeadDrafts(l: Lead, me: string): Drafts {
  const n = l.firstName
  const who = me ? `Меня зовут ${me}.` : ''
  const src = l.source ? `Ваш контакт у меня из «${l.source}».` : ''
  const role = l.role ? lcFirst(l.role) : ''
  const about = role && l.company ? `Вижу, что вы — ${role} в «${l.company}».`
    : role ? `Вижу, что вы — ${role}.`
    : l.company ? `Знаю, что вы связаны с «${l.company}».`
    : l.tags[0] ? `Тема «${l.tags[0]}», в которой вы работаете, мне очень близка.` : ''
  const join = (...p: string[]) => p.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  return {
    short: join(`${n}, здравствуйте!`, who, src, 'Хочется познакомиться — можно коротко написать вам?'),
    warm: join(`${n}, здравствуйте!`, who, src, about, 'Мне близко то, чем вы занимаетесь, и хочется просто познакомиться — без спешки и без продаж. Если вам интересно, расскажу о себе в паре предложений.'),
    business: join(`${n}, здравствуйте!`, who, src, about, 'Предлагаю короткий созвон на 15 минут: рассказать о себе и понять, где мы можем быть полезны друг другу. Когда вам удобно?'),
  }
}

/** One line under the name: position → why valuable → company → source. */
export const leadLine = (l: Pick<Lead, 'role' | 'company' | 'why' | 'source' | 'city'>) => (l.role ? jobLine(l) : l.why || l.company || l.city || l.source || '')
export const leadName = fullName
