import type { Interaction, Person } from '@/data/types'
import type { AskResult } from '../schemas'
import { dueContacts, nextBirthday, warmthOf } from '@/data/logic'
import { agoShort, inDays } from '@/lib/format'
import { t, tn } from '@/i18n'
import { lower, stem, stems } from './text'

/** Query stem → related stems. Russian and English side by side, so a question in one language finds profiles written in the other. */
export const ASK_SYN: Record<string, string[]> = {
  виз: ['дуба', 'юрист', 'релокац', 'переезд', 'эмиграц', 'dubai', 'lawyer', 'relocat', 'immigra'],
  оаэ: ['дуба', 'абу', 'dubai', 'abu'],
  эмират: ['дуба', 'абу', 'dubai', 'abu'],
  инвест: ['фонд', 'партнер', 'ангел', 'венчур', 'seed', 'fund', 'angel', 'venture', 'vc'],
  деньг: ['инвест', 'фонд', 'ангел', 'invest', 'fund', 'angel'],
  дизайн: ['ux', 'ui', 'дизайнер', 'designer'],
  разработ: ['cto', 'backend', 'инженер', 'rust', 'engineer', 'developer'],
  найм: ['рекрут', 'hr', 'кандидат', 'recruit', 'candidate'],
  юрист: ['прав', 'сделк', 'юрист', 'law', 'legal', 'deal'],
  пиар: ['журналист', 'медиа', 'pr', 'journalist', 'media'],
  медиа: ['журналист', 'forbes', 'pr', 'journalist', 'media'],
  ai: ['ai', 'ml', 'нейросет', 'data'],
  ии: ['ai', 'ml', 'нейросет'],
  ужин: ['вин', 'еда', 'ресторан', 'wine', 'food', 'restaurant'],
  спорт: ['бег', 'триатлон', 'теннис', 'йог', 'марафон', 'running', 'triathlon', 'tennis', 'yoga', 'marathon'],
  // English
  visa: ['дуба', 'юрист', 'релокац', 'переезд', 'dubai', 'lawyer', 'relocat', 'immigra', 'legal'],
  uae: ['дуба', 'абу', 'dubai', 'abu'],
  emirates: ['дуба', 'абу', 'dubai', 'abu'],
  invest: ['фонд', 'партнер', 'ангел', 'венчур', 'seed', 'fund', 'angel', 'venture', 'vc', 'partner'],
  money: ['инвест', 'фонд', 'ангел', 'invest', 'fund', 'angel'],
  funding: ['инвест', 'фонд', 'ангел', 'invest', 'fund', 'angel', 'seed'],
  capital: ['инвест', 'фонд', 'ангел', 'invest', 'fund', 'angel'],
  design: ['ux', 'ui', 'дизайнер', 'designer'],
  develop: ['cto', 'backend', 'инженер', 'rust', 'engineer', 'software'],
  engineer: ['cto', 'backend', 'инженер', 'rust', 'developer', 'software'],
  hiring: ['рекрут', 'hr', 'кандидат', 'recruit', 'candidate', 'talent'],
  recruit: ['рекрут', 'hr', 'кандидат', 'candidate', 'talent'],
  lawyer: ['прав', 'сделк', 'юрист', 'law', 'legal', 'deal', 'corporate'],
  legal: ['прав', 'сделк', 'юрист', 'law', 'lawyer', 'deal'],
  press: ['журналист', 'медиа', 'pr', 'journalist', 'media'],
  journalist: ['журналист', 'медиа', 'forbes', 'pr', 'media'],
  media: ['журналист', 'forbes', 'pr', 'journalist'],
  dinner: ['вин', 'еда', 'ресторан', 'wine', 'food', 'restaurant'],
  sport: ['бег', 'триатлон', 'теннис', 'йог', 'марафон', 'running', 'triathlon', 'tennis', 'yoga', 'marathon'],
}

interface Field { text: string; w: number; name: string; notes?: boolean }

function fieldsOf(p: Person, notes: string): Field[] {
  return [
    { text: p.role ?? '', w: 3, name: t('role', undefined, 'field') },
    { text: p.company ?? '', w: 2, name: t('company', undefined, 'field') },
    { text: p.city ?? '', w: 3, name: t('city', undefined, 'field') },
    { text: p.tags.join(' '), w: 2.5, name: t('interests', undefined, 'field') },
    { text: p.canHelpMe ?? '', w: 3, name: t('strong at', undefined, 'field') },
    { text: p.lookingFor ?? '', w: 2, name: t('looking for', undefined, 'field') },
    { text: p.facts.map(f => f.text).join(' '), w: 1.5, name: t('facts', undefined, 'field') },
    { text: p.metPlace ?? '', w: 1.5, name: t('met', undefined, 'field') },
    { text: (p.notes ?? '') + ' ' + notes, w: 1, name: '', notes: true },
  ]
}

/** The local "ask the network": semantic intents plus ranking by fields. */
export function localAsk(q: string, people: Person[], interactions: Interaction[], now = Date.now()): AskResult {
  const query = lower(q)
  const active = people.filter(p => !p.archived)

  if (/день рожд|\bдр\b|родил|birthday|bday|\bborn\b/.test(query)) {
    const list = active.map(p => ({ p, b: nextBirthday(p.birthday, now) })).filter(x => x.b && x.b.days <= 45).sort((a, b) => a.b!.days - b.b!.days).slice(0, 8)
    return {
      answer: list.length ? tn(list.length, 'Upcoming birthdays — {n} person in the next six weeks.', 'Upcoming birthdays — {n} people in the next six weeks.') : t('No birthdays in the next six weeks.'),
      people: list.map(({ p, b }) => ({ id: p.id, reason: `${inDays(b!.days)}${b!.turning ? ` · ${t('turns {years}', { years: b!.turning })}` : ''}${p.giftIdeas ? ` · ${t('gift: {gift}', { gift: p.giftIdeas })}` : ''}` })),
      follow_ups: [t('Who should I write to ahead of time?'), t('Which gifts to pick?')],
    }
  }
  if (/давно|остыва|не общал|не писал|забыл|потерял|haven'?t (?:talked|spoken|heard|been in touch|contacted|written)|while since|long time|gone cold|cooling|lost touch|overdue|neglect|forgot/.test(query)) {
    let list = dueContacts(active, now)
    if (/инвест|investor|\bfund\b|\bangel\b|\bvc\b/.test(query)) list = list.filter(x => /инвест|фонд|ангел|партн|invest|fund|angel|venture|partner/i.test(`${x.p.role} ${x.p.company} ${x.p.tags.join(' ')}`))
    return {
      answer: list.length ? tn(list.length, '{n} connection has outgrown its rhythm. Start with the closest — they matter more.', '{n} connections have outgrown their rhythm. Start with the closest — they matter more.') : t('All connections are on rhythm — no one is waiting.'),
      people: list.slice(0, 8).map(({ p, w }) => ({ id: p.id, reason: t('{days} d without contact, rhythm every {cadence} d', { days: w.daysSince, cadence: w.cadence }) })),
      follow_ups: [t('What reason can I find for each?'), t('Who is best to invite to a meeting?')],
    }
  }
  if (/недавно|на этой неделе|последн|новые знаком|recent|this week|lately|latest|new (?:contacts|acquaintances|people|connections)/.test(query)) {
    const fresh = /новые|new (?:contacts|acquaintances|people|connections)/.test(query)
    const list = [...active].sort((a, b) => (fresh ? b.createdAt - a.createdAt : (b.lastContactAt ?? 0) - (a.lastContactAt ?? 0))).slice(0, 8)
    return {
      answer: fresh ? t('The freshest acquaintances:') : t('Latest contacts:'),
      people: list.map(p => ({ id: p.id, reason: fresh ? t('in network: {ago}', { ago: agoShort(p.createdAt, now) }) + (p.metPlace ? ` · ${p.metPlace}` : '') : t('last contact: {ago}', { ago: agoShort(p.lastContactAt, now) }) })),
      follow_ups: [t('Who should I send a follow-up to?')],
    }
  }

  // general search by meaning
  const qs = stems(q)
  const expanded = new Set(qs)
  for (const s of qs) for (const [k, v] of Object.entries(ASK_SYN)) if (s.startsWith(k)) { for (const x of v) expanded.add(x) }
  const terms = [...expanded].filter(s => s.length >= 2)
  if (!terms.length) return { answer: t('Refine the question — for example, “who can help with a UAE visa?” or “who should I invite to a dinner about AI?”'), people: [], follow_ups: [] }

  const notesBy = new Map<string, string>()
  for (const it of interactions) for (const pid of it.personIds) notesBy.set(pid, `${notesBy.get(pid) ?? ''} ${it.title ?? ''} ${it.note ?? ''}`)

  const scored = active.map(p => {
    let score = 0
    const why: string[] = []
    for (const f of fieldsOf(p, notesBy.get(p.id) ?? '')) {
      if (!f.text.trim()) continue
      const fs = lower(f.text).split(/[^a-zа-я0-9]+/).filter(Boolean).map(stem)
      const hits = terms.filter(n => fs.some(s => s.startsWith(n) || (s.length >= 4 && n.startsWith(s))))
      if (hits.length) {
        score += hits.length * f.w
        why.push(f.notes ? t('mentioned in notes') : `${f.name}: ${f.text.length > 60 ? f.text.slice(0, 60) + '…' : f.text}`)
      }
    }
    // warm connections slightly higher
    const w = warmthOf(p, now)
    if (score) score += w.level === 'hot' ? 0.6 : w.level === 'warm' ? 0.4 : 0
    return { p, score, why }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8)

  return {
    answer: scored.length
      ? tn(scored.length, 'Found {n} person — the best matches are on top.', 'Found {n} people — the best matches are on top.')
      : t('No direct matches. Try rephrasing, or connect Astra to a model — it searches by meaning.'),
    people: scored.map(x => ({ id: x.p.id, reason: x.why.slice(0, 2).join(' · ') })),
    follow_ups: scored.length ? [t('Who is the warmest contact among them?'), t('Who else could I ask about this?')] : [],
  }
}
