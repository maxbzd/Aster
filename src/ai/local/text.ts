import type { Person } from '@/data/types'
import { DAY, startOfDay, toISODate } from '@/lib/format'

/*
 * The on-device engine understands Russian and English at the same time: patterns and vocabularies are the union of
 * both languages, so a mixed network ("Alexey — CTO в Spotify") works. What the engine *writes* follows the interface language.
 */

/* ---------- Normalization and light stemming (Russian endings; Latin words are left as they are) ---------- */

export type TextLang = 'ru' | 'en'
/** Language of a text by script: if Cyrillic letters are present in a noticeable share, it is Russian, otherwise English. */
export function textLang(s: string): TextLang {
  const cyr = (s.match(/[а-яё]/gi) ?? []).length
  const lat = (s.match(/[a-z]/gi) ?? []).length
  return cyr > 0 && cyr >= lat * 0.5 ? 'ru' : 'en'
}

export const lower = (s: string) => s.toLowerCase().replace(/ё/g, 'е')
export const words = (s: string) => lower(s).match(/[a-zа-я0-9]+/g) ?? []

const ENDINGS = [
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ией', 'иях', 'ах', 'ях', 'ая', 'яя', 'ое', 'ее', 'ой', 'ей', 'ий', 'ый',
  'ую', 'юю', 'ом', 'ем', 'ам', 'ям', 'ов', 'ев', 'ия', 'ья', 'ие', 'ье', 'ии', 'ью', 'ешь', 'ет', 'ут', 'ют', 'ит', 'ат', 'ят', 'ть',
  'ь', 'а', 'я', 'о', 'е', 'и', 'ы', 'у', 'ю', 'й',
]
export function stem(w: string) {
  if (w.length <= 3 || /^[a-z0-9]+$/.test(w)) return w
  for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length)
  return w
}

export const STOP = new Set([
  'кто', 'кого', 'кому', 'кем', 'что', 'чем', 'как', 'где', 'когда', 'какой', 'какие', 'какая', 'мне', 'меня', 'мой', 'мои', 'моих', 'моей', 'мою',
  'может', 'могут', 'мог', 'помочь', 'поможет', 'помогут', 'с', 'со', 'в', 'во', 'на', 'у', 'и', 'или', 'а', 'но', 'про', 'по', 'для', 'из', 'к', 'ко',
  'о', 'об', 'от', 'до', 'это', 'есть', 'нет', 'все', 'всех', 'сети', 'сеть', 'знает', 'знаю', 'человек', 'люди', 'людей', 'там', 'тут',
  'ли', 'бы', 'же', 'не', 'да', 'уже', 'еще', 'ещё', 'очень', 'так', 'тоже', 'его', 'ее', 'её', 'их', 'он', 'она', 'они', 'мы', 'ты', 'я',
  'был', 'была', 'были', 'будет', 'надо', 'нужно', 'хочу', 'хочет', 'ищу', 'найти', 'посоветовать', 'посоветуй', 'подскажи', 'позвать', 'pro',
  // English
  'who', 'whom', 'whose', 'what', 'which', 'how', 'where', 'when', 'why', 'can', 'could', 'would', 'should', 'will', 'may', 'might', 'help', 'helps', 'helped',
  'me', 'my', 'mine', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'his', 'her', 'their', 'it', 'its', 'with', 'in', 'on', 'at', 'for', 'from', 'of',
  'to', 'and', 'or', 'but', 'about', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'know', 'knows', 'anyone', 'anybody',
  'someone', 'somebody', 'people', 'person', 'network', 'have', 'has', 'had', 'need', 'needs', 'looking', 'look', 'find', 'want', 'wants', 'recommend',
  'suggest', 'any', 'some', 'there', 'here', 'this', 'that', 'these', 'those', 'not', 'no', 'yes', 'also', 'very', 'just', 'get', 'invite', 'ask', 'tell',
])

export const stems = (s: string) => words(s).filter(w => !STOP.has(w)).map(stem)

/** Регэксп «слово целиком» для кириллицы (\b не работает с кириллицей). */
export const wordRe = (body: string, flags = 'i') => new RegExp(`(?<![а-яёa-z0-9])(?:${body})(?![а-яёa-z0-9])`, flags)


export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
export const trimPunct = (s: string) => s.replace(/^[\s,—–-]+|[\s,.;:!?—–-]+$/g, '').trim()

/* ---------- Имена ---------- */

/** «с Артёмом» → «Артём», «Анной» → «Анна», «Сергеем» → «Сергей». */
export function nameToNominative(w: string) {
  const rules: [RegExp, string][] = [
    [/еем$/, 'ей'], [/аем$/, 'ай'], [/ием$/, 'ий'], [/ьей$/, 'ья'], [/ией$/, 'ия'], [/([лрн])ем$/, '$1ь'],
    [/ёй$/, 'я'], [/([кгхжшчщц])ой$/, '$1а'], [/ой$/, 'а'], [/ей$/, 'я'], [/ом$/, ''], [/ём$/, ''], [/ем$/, ''],
  ]
  for (const [re, to] of rules) if (re.test(w)) return w.replace(re, to)
  return w
}
export function surnameToNominative(w: string) {
  const rules: [RegExp, string][] = [
    [/(ов|ев|ёв|ин|ын)ым$/, '$1'], [/(ов|ев|ёв|ин|ын)ой$/, '$1а'], [/ским$/, 'ский'], [/ской$/, 'ская'], [/цким$/, 'цкий'], [/цкой$/, 'цкая'],
  ]
  for (const [re, to] of rules) if (re.test(w)) return w.replace(re, to)
  return w
}

const NAME_ENDINGS = 'а|ы|е|у|ой|ою|ей|ею|ом|ем|ём|ю|я|и|ьи|ье|ью|ии|ия|ию|ией'
function nameStem(n: string) {
  const l = lower(n)
  if (l.length >= 4 && /[аяйьо]$/.test(l)) return l.slice(0, -1)
  if (l.length >= 5 && /(ий|ей)$/.test(l)) return l.slice(0, -2)
  return l
}
export function personNameRe(p: Pick<Person, 'firstName' | 'nickname'>) {
  const forms = [p.firstName, p.nickname].filter(Boolean).map(n => {
    const s = nameStem(n!)
    const latin = /^[a-z0-9 .'’-]+$/.test(s)
    if (latin) return `${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['’]s)?`
    return s === lower(n!) ? `${s}(?:${NAME_ENDINGS})?` : `${s}(?:${NAME_ENDINGS})`
  })
  return wordRe(forms.join('|'))
}

/** Найти упомянутых в тексте людей из сети. */
export function findMentioned(text: string, people: Person[]) {
  const query = lower(text)
  const hits: { p: Person; index: number; pos: number }[] = []
  for (const p of people) {
    if (p.archived || p.firstName.length < 2) continue
    const m = personNameRe(p).exec(query)
    if (!m) continue
    // если в тексте есть фамилия — уверенность выше
    const lastOk = p.lastName ? wordRe(nameStem(p.lastName) + '\\w{0,3}').test(query) : false
    hits.push({ p, index: m.index - (lastOk ? 10_000 : 0), pos: m.index })
  }
  // одинаковые имена: оставляем того, у кого совпала фамилия, иначе самого «тёплого»
  const byName = new Map<string, { p: Person; index: number; pos: number }[]>()
  for (const h of hits) byName.set(lower(h.p.firstName), [...(byName.get(lower(h.p.firstName)) ?? []), h])
  const out: { p: Person; pos: number }[] = []
  for (const group of byName.values()) {
    group.sort((a, b) => a.index - b.index || (b.p.lastContactAt ?? 0) - (a.p.lastContactAt ?? 0))
    out.push({ p: group[0].p, pos: group[0].pos })
  }
  // в порядке упоминания в тексте: «ужинали с Даниилом и Алиной» — главный герой Даниил
  return out.sort((a, b) => a.pos - b.pos).map(x => x.p)
}

/* ---------- Даты ---------- */

const NUM: Record<string, number> = {
  один: 1, одну: 1, одна: 1, два: 2, две: 2, пару: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  несколько: 3, полтора: 1.5, полторы: 1.5,
}
const NUM_EN: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, couple: 2, 'a couple of': 2, three: 3, 'a few': 3, few: 3, several: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}
const MONTH_EN = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const monthIndexEn = (w: string) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(w.toLowerCase().slice(0, 3))
const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
export const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр']
const MONTH_RE = '(январ[а-я]*|феврал[а-я]*|март[а-я]*|апрел[а-я]*|ма[йяе]|июн[а-я]*|июл[а-я]*|август[а-я]*|сентябр[а-я]*|октябр[а-я]*|ноябр[а-я]*|декабр[а-я]*)'
export const monthIndex = (w: string) => {
  const l = lower(w)
  if (/^ма[йяе]$/.test(l)) return 4
  return MONTHS.findIndex((m, i) => i !== 4 && l.startsWith(m))
}
const WEEKDAYS = ['воскресень', 'понедельник', 'вторник', 'сред', 'четверг', 'пятниц', 'суббот']

/** "When" in a text → date (YYYY-MM-DD) or null. Understands Russian and English phrases. */
export function parseWhen(text: string, now = Date.now()): string | null {
  return parseWhenRu(text, now) ?? parseWhenEn(text, now)
}

function parseWhenEn(text: string, now: number): string | null {
  const q = text.toLowerCase()
  const today = startOfDay(now)
  const add = (d: number) => toISODate(today + Math.round(d) * DAY)
  if (/\bday after tomorrow\b/.test(q)) return add(2)
  if (/\b(?:tomorrow|tmrw)\b/.test(q)) return add(1)
  if (/\bnext week\b|\bin a week\b|\bin 1 week\b/.test(q)) return add(7)
  if (/\bend of (?:the )?week\b|\b(?:this|on the|over the) weekend\b/.test(q)) return add(((6 - new Date(now).getDay() + 7) % 7) || 7)
  if (/\bend of (?:the )?month\b/.test(q)) { const d = new Date(now); return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
  if (/\bin (?:half a year|six months|6 months)\b/.test(q)) return add(182)
  if (/\bin a year\b|\bnext year\b/.test(q)) return add(365)
  if (/\bin a month\b|\bnext month\b/.test(q)) return add(30)
  const m = q.match(/\bin\s+(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple of|couple|several)\s*(day|week|month|hour)s?\b/)
  if (m) {
    const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : NUM_EN[m[1]!] ?? 0
    if (n) return m[2] === 'week' ? add(n * 7) : m[2] === 'month' ? add(n * 30) : m[2] === 'hour' ? add(0) : add(n)
  }
  const wd = q.match(new RegExp(`\\b(?:on |next |this |by |until )?(${WEEKDAYS_EN.join('|')})\\b`))
  if (wd) {
    const target = WEEKDAYS_EN.indexOf(wd[1]!)
    return add(((target - new Date(now).getDay() + 7) % 7) || 7)
  }
  const pick = (mi: number, day: number) => {
    const y = new Date(now).getFullYear()
    let d = new Date(y, mi, day).getTime()
    if (d < today) d = new Date(y + 1, mi, day).getTime()
    return toISODate(d)
  }
  const dm = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_EN})\\b`)) 
  if (dm) return pick(monthIndexEn(dm[2]!), Number(dm[1]))
  const md = q.match(new RegExp(`\\b(${MONTH_EN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`))
  if (md) return pick(monthIndexEn(md[1]!), Number(md[2]))
  const mo = q.match(new RegExp(`\\b(?:in|early|late|mid|after|by)\\s+(${MONTH_EN})\\b`))
  if (mo) return pick(monthIndexEn(mo[1]!), 1)
  if (/\bafter (?:the )?(?:vacation|holiday|holidays|break)\b/.test(q)) return add(21)
  if (/\bin a few days\b|\bsoon\b/.test(q)) return add(3)
  return null
}

function parseWhenRu(text: string, now: number): string | null {
  const query2 = lower(text)
  const today = startOfDay(now)
  const add = (d: number) => toISODate(today + Math.round(d) * DAY)
  if (wordRe('послезавтра').test(query2)) return add(2)
  if (wordRe('завтра').test(query2)) return add(1)
  if (/на следующей неделе|на той неделе|через неделю/.test(query2)) return add(7)
  if (/в конце недели|на выходных/.test(query2)) return add(((6 - new Date(now).getDay() + 7) % 7) || 7)
  if (/в конце месяца/.test(query2)) { const d = new Date(now); return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
  if (/через полгода/.test(query2)) return add(182)
  if (/через год/.test(query2)) return add(365)
  if (/через месяц/.test(query2)) return add(30)
  const m = query2.match(/через\s+(\d+|[а-я]+)\s+(дн[а-я]*|день|недел[а-я]*|месяц[а-я]*|час[а-я]*)/)
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1]] ?? 0
    if (n) {
      if (m[2].startsWith('недел')) return add(n * 7)
      if (m[2].startsWith('месяц')) return add(n * 30)
      if (m[2].startsWith('час')) return add(0)
      return add(n)
    }
  }
  const wd = query2.match(/в(?:о)?\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)/)
  if (wd) {
    const target = WEEKDAYS.findIndex(w => wd[1].startsWith(w))
    const diff = ((target - new Date(now).getDay() + 7) % 7) || 7
    return add(diff)
  }
  const dm = query2.match(new RegExp(`(\\d{1,2})\\s+${MONTH_RE}`))
  if (dm) {
    const mi = monthIndex(dm[2])
    if (mi >= 0) {
      const y = new Date(now).getFullYear()
      let d = new Date(y, mi, Number(dm[1])).getTime()
      if (d < today) d = new Date(y + 1, mi, Number(dm[1])).getTime()
      return toISODate(d)
    }
  }
  const mo = query2.match(new RegExp(`(?:в|в начале|после)\\s+${MONTH_RE}`))
  if (mo) {
    const mi = monthIndex(mo[1])
    if (mi >= 0) {
      const y = new Date(now).getFullYear()
      let d = new Date(y, mi, 1).getTime()
      if (d < today) d = new Date(y + 1, mi, 1).getTime()
      return toISODate(d)
    }
  }
  if (/после (?:отпуска|праздников|каникул)/.test(query2)) return add(21)
  if (/на днях|скоро/.test(query2)) return add(3)
  return null
}

/** "birthday May 14 (1990)" / «день рождения 14 мая (1990)» → --05-14 / 1990-05-14 */
export function parseBirthday(text: string): string | null {
  return parseBirthdayRu(text) ?? parseBirthdayEn(text)
}

function parseBirthdayEn(text: string): string | null {
  const q = text.toLowerCase()
  const lead = '(?:birthday|bday|b-day|born)(?:\\s+(?:is|was|on|in|the|date))*[\\s:,–-]{0,4}'
  const a = q.match(new RegExp(`${lead}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_EN})\\b(?:,?\\s+(\\d{4}))?`))
  const b = a ? null : q.match(new RegExp(`${lead}(${MONTH_EN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`))
  if (!a && !b) return null
  const mi = monthIndexEn(a ? a[2]! : b![1]!)
  const day = Number(a ? a[1] : b![2])
  const year = a ? a[3] : b![3]
  if (mi < 0 || day < 1 || day > 31) return null
  const mm = String(mi + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return year ? `${year}-${mm}-${dd}` : `--${mm}-${dd}`
}

function parseBirthdayRu(text: string): string | null {
  const query3 = lower(text)
  const m = query3.match(new RegExp(`(?:день рождени[яе]|др|родил[а-я]*)[^0-9]{0,12}(\\d{1,2})\\s+${MONTH_RE}(?:\\s+(\\d{4}))?`))
  if (!m) return null
  const mi = monthIndex(m[2])
  if (mi < 0) return null
  const mm = String(mi + 1).padStart(2, '0')
  const dd = String(Number(m[1])).padStart(2, '0')
  return m[3] ? `${m[3]}-${mm}-${dd}` : `--${mm}-${dd}`
}

/** Splits a text into meaningful clauses. */
export const clauses = (text: string) =>
  text.replace(/\s+/g, ' ').split(/(?<=[.!?;])\s+|\n+|,\s*(?=(?:а|и|но|ещё|еще|также|он|она|они|у него|у неё|у нее|договорились|обещал|хочет|ищет|любит|and|but|also|he|she|they|his|her|their|agreed|promised|wants|is looking|loves)\s)/i).map(s => s.trim()).filter(Boolean)
