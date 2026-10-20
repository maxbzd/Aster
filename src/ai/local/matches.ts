import type { Person } from '@/data/types'
import { fullName, jobLine, lcFirst } from '@/lib/format'
import { t } from '@/i18n'
import { lower, stem, stems } from './text'

export interface MatchPair {
  a: Person // кто ищет
  b: Person // кто может помочь
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

/** Всё, что для сравнения нужно знать о человеке, считается один раз, а не заново для каждой пары (n² → n). */
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

/** Локальный «сводник»: кто ищет то, в чём силён другой. */
export function localMatches(people: Person[], excluded: Set<string> = new Set()): MatchPair[] {
  const active = people.filter(p => !p.archived).map(prep)
  const pairs: MatchPair[] = []
  for (const A of active) {
    const a = A.p
    if (!a.lookingFor || !A.need) continue
    const need = A.need
    for (const B of active) {
      const b = B.p
      if (b.id === a.id || alreadyLinked(A, B)) continue
      if (excluded.has(`${a.id}:${b.id}`) || excluded.has(`${b.id}:${a.id}`)) continue
      let score = 0
      let best: { label?: string; w: number; living?: boolean } | null = null
      for (const f of B.fields) {
        const hits = need.filter(n => n.length >= 2 && f.fs.some(s => s.startsWith(n) || n.startsWith(s)))
        const cityHit = f.living && A.needsCity.some(g => g.some(c => f.text.includes(c)))
        const gain = hits.length * f.w + (cityHit ? 4 : 0)
        if (gain > 0) { score += gain; if (!best || gain > best.w) best = { label: f.label, w: gain, living: f.living } }
      }
      // взаимная польза: B тоже что-то ищет у A
      let mutual = false
      if (B.back && b.lookingFor) {
        if (B.back.some(n => A.own.some(s => s.startsWith(n)))) { score += 3; mutual = true }
      }
      if (score >= 3 && best?.label) {
        pairs.push({
          a, b, score,
          reason: t('{a} is looking for “{need}”, and {b} can help: {what}', { a: a.firstName, need: a.lookingFor, b: b.firstName, what: best.living ? best.label : lowerFirst(best.label) }),
          value: mutual
            ? t('Mutual benefit: {b} is also looking for “{need}”', { b: b.firstName, need: b.lookingFor ?? '' })
            : b.lookingFor
              ? t('{a} gets a solution, {b} gets a chance at “{need}”', { a: a.firstName, b: b.firstName, need: b.lookingFor })
              : t('{a} gets a solution, {b} gets a new strong contact', { a: a.firstName, b: b.firstName }),
        })
      }
    }
  }
  // лучшие пары: одна пара на «ищущего», и A×B не повторяется как B×A
  pairs.sort((x, y) => y.score - x.score)
  const seekers = new Set<string>()
  const seen = new Set<string>()
  return pairs.filter(p => {
    const key = [p.a.id, p.b.id].sort().join(':')
    if (seekers.has(p.a.id) || seen.has(key)) return false
    seekers.add(p.a.id)
    seen.add(key)
    return true
  }).slice(0, 10)
}

const lowerFirst = lcFirst

export const pairTitle = (m: MatchPair) => `${fullName(m.a)} × ${fullName(m.b)}`
export const pairSub = (m: MatchPair) => [jobLine(m.a), jobLine(m.b)].filter(Boolean).join('  ↔  ')
