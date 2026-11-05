import type { Person } from '@/data/types'
import { fullName, jobLine, lcFirst } from '@/lib/format'
import { t } from '@/i18n'
import { lower, stem, stems } from './text'

export interface MatchPair {
  a: Person // who is looking
  b: Person // who can help
  reason: string
  value: string
  score: number
}

/** Synonyms, so "looking for a CTO" finds a "technical director" or an "engineer". Russian and English side by side. */
const SYN: [string[], string[]][] = [
  [['cto', 'технич', 'инженер', 'разработ', 'программ', 'кофаундер', 'tech', 'engineer', 'developer', 'software', 'cofounder', 'co-founder'], ['cto', 'разработ', 'backend', 'архитектур', 'rust', 'инженер', 'технич', 'engineer', 'developer', 'architect', 'software']],
  [['инвест', 'фонд', 'раунд', 'seed', 'венчур', 'деньг', 'финансир', 'invest', 'fund', 'round', 'venture', 'money', 'capital', 'financ'], ['инвест', 'фонд', 'партнер', 'ангел', 'венчур', 'seed', 'раунд', 'чек', 'invest', 'fund', 'partner', 'angel', 'venture', 'round']],
  [['дизайн', 'ux', 'ui', 'интерфейс', 'design', 'interface'], ['дизайн', 'ux', 'ui', 'design']],
  [['юрист', 'прав', 'договор', 'сделк', 'lawyer', 'legal', 'contract', 'deal', 'attorney'], ['юрист', 'прав', 'сделк', 'm&a', 'корпоратив', 'lawyer', 'legal', 'corporate', 'attorney']],
  [['pr', 'медиа', 'пиар', 'пресс', 'стать', 'истори', 'media', 'press', 'publicity', 'article'], ['журналист', 'медиа', 'forbes', 'pr', 'пиар', 'journalist', 'media', 'editor']],
  [['ментор', 'совет', 'наставн', 'mentor', 'advice', 'advisor', 'adviser'], ['ментор', 'менторит', 'наставн', 'совет', 'mentor', 'advisor', 'adviser']],
  [['найм', 'команд', 'кандидат', 'рекрут', 'продакт', 'дизайнер', 'hire', 'hiring', 'candidate', 'recruit', 'team'], ['найм', 'рекрут', 'кандидат', 'рекоменд', 'recruit', 'candidate', 'talent', 'hr']],
  [['спикер', 'выступ', 'доклад', 'конференц', 'speaker', 'talk', 'keynote', 'conference'], ['ai', 'продукт', 'основател', 'эксперт', 'founder', 'expert', 'product']],
  [['продукт', 'product', 'продакт'], ['продукт', 'product', 'cpo', 'продакт']],
  [['edtech', 'образован', 'обучен', 'education'], ['edtech', 'образован', 'education']],
  [['healthtech', 'медицин', 'здоров', 'health', 'medical'], ['healthtech', 'медицин', 'health', 'medical']],
  [['ai', 'ии', 'нейросет', 'ml', 'machine learning'], ['ai', 'ml', 'нейросет', 'data']],
]

/** A city by group of spellings: Russian stems and English names. */
const CITY_GROUPS = [
  ['москв', 'moscow'], ['петербург', 'petersburg'], ['дуба', 'dubai'], ['лиссабон', 'lisbon'], ['тбилис', 'tbilisi'], ['ереван', 'yerevan'], ['белград', 'belgrade'],
  ['алмат', 'almaty'], ['бали', 'bali'], ['лондон', 'london'], ['берлин', 'berlin'], ['казан', 'kazan'], ['баку', 'baku'], ['сеул', 'seoul'], ['барселон', 'barcelona'],
  ['екатеринбург', 'yekaterinburg'], ['новосибирск', 'novosibirsk'], ['париж', 'paris'], ['нью-йорк', 'new york'], ['сингапур', 'singapore'], ['стамбул', 'istanbul'],
]

export function expand(needStems: string[]) {
  const out = new Set(needStems)
  for (const [keys, targets] of SYN) if (needStems.some(s => keys.some(k => s.startsWith(k)))) { for (const item of targets) out.add(item) }
  return [...out]
}

function offerFields(p: Person): { text: string; w: number; label?: string; living?: boolean }[] {
  return [
    { text: lower(p.role ?? ''), w: 3, label: p.role },
    { text: lower(p.canHelpMe ?? ''), w: 2.5, label: p.canHelpMe },
    { text: lower(p.tags.join(' ')), w: 1.5, label: p.tags.join(', ') },
    { text: lower(p.company ?? ''), w: 1, label: p.company },
    { text: lower(p.city ?? ''), w: 2, label: p.city ? t('lives in: {city}', { city: p.city }) : undefined, living: true },
  ]
}

/** Everything needed to compare a person is computed once, not again for every pair (n² → n). */
interface Prep {
  p: Person
  fields: { text: string; w: number; label?: string; fs: string[]; living: boolean }[]
  company: string
  own: string[]
  need: string[] | null
  needsCity: string[][]
  back: string[] | null
}

function prep(p: Person): Prep {
  const need = p.lookingFor ? expand(stems(p.lookingFor)) : null
  return {
    p,
    fields: offerFields(p).filter(f => f.text).map(f => ({ ...f, fs: f.text.split(/[^a-zа-я0-9&]+/).filter(Boolean).map(stem), living: !!f.living })),
    company: p.company ? lower(p.company) : '',
    own: stems([p.role, p.canHelpMe, p.tags.join(' '), p.city].filter(Boolean).join(' ')),
    need,
    needsCity: need ? CITY_GROUPS.filter(g => g.some(c => need.some(s => s.startsWith(c)))) : [],
    back: need,
  }
}

const alreadyLinked = (a: Prep, b: Prep) =>
  a.p.links.some(l => l.personId === b.p.id) || b.p.links.some(l => l.personId === a.p.id) || a.p.introducedBy === b.p.id || b.p.introducedBy === a.p.id ||
  (!!a.company && !!b.company && a.company === b.company)

/** The local "matchmaker": who is looking for what another is strong at. */
export function localMatches(people: Person[], excluded: Set<string> = new Set()): MatchPair[] {
  const active = people.filter(p => !p.archived).map(prep)
  // Candidates stay small (no sentences yet): in a big network almost every pair can match, and writing two sentences for each of
  // hundreds of thousands of pairs cost seconds. Only the few that are shown get their text.
  interface Candidate { A: Prep; B: Prep; score: number; best: { label?: string; w: number; living?: boolean }; mutual: boolean }
  const found: Candidate[] = []
  const TOP_PER_SEEKER = 11 // the list shows 10 pairs
  // A pair can only score through a word of one that begins like a word of the other (or through a city), so for each seeker
  // only the people who have such a word are looked at, in their original order: the same pairs as comparing everyone with
  // everyone, at a fraction of the work in a big network.
  const byStart = new Map<string, number[]>()
  active.forEach((B, i) => {
    const keys = new Set<string>()
    for (const f of B.fields) for (const w of f.fs) keys.add(w.length >= 2 ? w.slice(0, 2) : w)
    for (const k of keys) { const list = byStart.get(k); if (list) list.push(i); else byStart.set(k, [i]) }
  })
  for (const A of active) {
    const a = A.p
    if (!a.lookingFor || !A.need) continue
    const need = A.need
    let pool: Prep[] = active
    if (A.needsCity.length === 0) {
      const idx = new Set<number>()
      for (const n of need) {
        if (n.length < 2) continue
        for (const i of byStart.get(n.slice(0, 2)) ?? []) idx.add(i) // words of two letters or more that begin like this one
        for (const i of byStart.get(n[0]!) ?? []) idx.add(i) // one-letter words
      }
      pool = [...idx].sort((x, y) => x - y).map(i => active[i]!)
    }
    const gainOf = new Map<string, { hits: number; city: boolean }>()
    const mine: Candidate[] = []
    for (const B of pool) {
      const b = B.p
      if (b.id === a.id || alreadyLinked(A, B)) continue
      if (excluded.size > 0 && (excluded.has(`${a.id}:${b.id}`) || excluded.has(`${b.id}:${a.id}`))) continue
      let score = 0
      let best: { label?: string; w: number; living?: boolean } | null = null
      for (const f of B.fields) {
        // roles, cities and tags repeat a lot across a network: the answer for one seeker and one text is worked out once
        let m = gainOf.get(f.text)
        if (!m) {
          m = { hits: need.filter(n => n.length >= 2 && f.fs.some(s => s.startsWith(n) || n.startsWith(s))).length, city: A.needsCity.some(g => g.some(c => f.text.includes(c))) }
          gainOf.set(f.text, m)
        }
        const gain = m.hits * f.w + (f.living && m.city ? 4 : 0)
        if (gain > 0) { score += gain; if (!best || gain > best.w) best = { label: f.label, w: gain, living: f.living } }
      }
      // mutual benefit: B is also looking for something A has
      let mutual = false
      if (B.back && b.lookingFor) {
        if (B.back.some(n => A.own.some(s => s.startsWith(n)))) { score += 3; mutual = true }
      }
      if (score >= 3 && best?.label) {
        // only a seeker's best few can ever be shown (at most TOP_PER_SEEKER - 1 of them can be skipped as the mirror of an earlier pair),
        // so the rest are not kept: in a big network that is millions of pairs
        if (mine.length === TOP_PER_SEEKER && score <= mine[TOP_PER_SEEKER - 1]!.score) continue
        const c: Candidate = { A, B, score, best, mutual }
        let at = mine.length
        while (at > 0 && mine[at - 1]!.score < score) at--
        mine.splice(at, 0, c)
        if (mine.length > TOP_PER_SEEKER) mine.pop()
      }
    }
    found.push(...mine)
  }
  // the best pairs: one pair per "seeker", and A×B is not repeated as B×A
  found.sort((x, y) => y.score - x.score)
  const seekers = new Set<string>()
  const seen = new Set<string>()
  const chosen: Candidate[] = []
  for (const c of found) {
    const key = [c.A.p.id, c.B.p.id].sort().join(':')
    if (seekers.has(c.A.p.id) || seen.has(key)) continue
    seekers.add(c.A.p.id)
    seen.add(key)
    chosen.push(c)
    if (chosen.length === 10) break
  }
  return chosen.map(({ A, B, score, best, mutual }): MatchPair => {
    const a = A.p, b = B.p
    return {
      a, b, score,
      reason: t('{a} is looking for “{need}”, and {b} can help: {what}', { a: a.firstName, need: a.lookingFor ?? '', b: b.firstName, what: best.living ? best.label! : lowerFirst(best.label!) }),
      value: mutual
        ? t('Mutual benefit: {b} is also looking for “{need}”', { b: b.firstName, need: b.lookingFor ?? '' })
        : b.lookingFor
          ? t('{a} gets a solution, {b} gets a chance at “{need}”', { a: a.firstName, b: b.firstName, need: b.lookingFor })
          : t('{a} gets a solution, {b} gets a new strong contact', { a: a.firstName, b: b.firstName }),
    }
  })
}

const lowerFirst = lcFirst

export const pairTitle = (m: MatchPair) => `${fullName(m.a)} × ${fullName(m.b)}`
export const pairSub = (m: MatchPair) => [jobLine(m.a), jobLine(m.b)].filter(Boolean).join('  ↔  ')
