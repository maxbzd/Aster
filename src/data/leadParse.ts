import type { Channel, Lead, Person } from './types'
import { uid } from './db'
import { fullName } from '@/lib/format'
import { msg, t } from '@/i18n'

/**
 * Parsing "raw" data into reserve cards: free text, links, spreadsheet rows.
 * Everything is local and model-free — fast, free, and nothing leaves the device. Recognition is bilingual (Russian + English);
 * the tags and city names it writes follow the interface language.
 */

export interface ParsedLead {
  firstName: string
  lastName?: string
  company?: string
  role?: string
  city?: string
  why?: string
  source?: string
  tags: string[]
  channels: Channel[]
  notes?: string
}

/* ---------- Contact channels ---------- */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const SOCIAL_URL = /(?:https?:\/\/)?(?:www\.|m\.|[a-z]{2}\.)?(?:linkedin\.com\/(?:in|pub)\/[^\s,;)>\]"']+|instagram\.com\/[A-Za-z0-9._]+|(?:t|telegram)\.me\/[A-Za-z0-9_]+|(?:x|twitter)\.com\/[A-Za-z0-9_]+|wa\.me\/\d+)\/?/gi
const ANY_URL = /(?:https?:\/\/|www\.)[^\s,;)>\]"']+/gi
const LABELED_TG = /(?<![\p{L}\d])(?:telegram|телеграм\w*|телега|tg|тг)\s*[:\-–]?\s*@?([A-Za-z][A-Za-z0-9_]{3,31})(?![\w])/giu
const LABELED_IG = /(?<![\p{L}\d])(?:instagram|инстаграм\w*|инста|insta|ig|инст)\s*[:\-–]?\s*@?([A-Za-z0-9][A-Za-z0-9._]{2,29})(?![\w])/giu
const BARE_HANDLE = /(?<![\w@.\/])@([A-Za-z][A-Za-z0-9_]{3,31})(?![\w@])/g
const PHONE = /(?<![\w@./-])\+?\d[\d\s().-]{8,18}\d(?![\w])/g

const FREE_MAIL = /^(gmail|googlemail|mail|yandex|ya|rambler|bk|list|inbox|icloud|me|mac|outlook|hotmail|live|msn|yahoo|proton|protonmail|pm|aol|gmx|zoho|tutanota|qq|163)\./i

/** Placeholder for a card without a name: stored in the language it was created in, recognised in both. */
export const isNoName = (s?: string) => s === 'Без имени' || s === 'No name'

export const digitsOf = (s: string) => s.replace(/\D/g, '')

/** A number that Excel stores as a plain number (79001234567) → "+7 900 123-45-67". Anything else is left alone. */
export function prettyPhone(raw: string) {
  const v = raw.trim()
  const d = digitsOf(v)
  if (!v.startsWith('+') && /^[78]\d{10}$/.test(d)) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`
  if (/^\d{10,15}$/.test(v)) return `+${v}`
  return v
}
const isPhone = (s: string) => { const n = digitsOf(s).length; return n >= 10 && n <= 15 }

const cleanUrl = (u: string) => u.replace(/[?#].*$/, '').replace(/[.,;:!]+$/, '')
const handleFrom = (v: string) => v.trim().replace(/^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '')

/** Pulls emails, social links and phone numbers out of a text and returns the rest without them. */
export function extractContacts(text: string): { rest: string; channels: Channel[] } {
  const channels: Channel[] = []
  let rest = text
  const add = (c: Channel) => { if (c.value && !channels.some(x => x.type === c.type && x.value.toLowerCase() === c.value.toLowerCase())) channels.push(c) }

  rest = rest.replace(EMAIL, m => { add({ type: 'email', value: m.toLowerCase() }); return ' ' })
  rest = rest.replace(SOCIAL_URL, raw => {
    const m = cleanUrl(raw)
    if (/linkedin\.com/i.test(m)) add({ type: 'linkedin', value: m.startsWith('http') ? m : `https://${m.replace(/^www\./i, 'www.')}` })
    else if (/instagram\.com/i.test(m)) add({ type: 'instagram', value: handleFrom(m) })
    else if (/(?:t|telegram)\.me/i.test(m)) add({ type: 'telegram', value: handleFrom(m) })
    else if (/(?:x|twitter)\.com/i.test(m)) add({ type: 'x', value: handleFrom(m) })
    else if (/wa\.me/i.test(m)) add({ type: 'whatsapp', value: `+${digitsOf(m)}` })
    return ' '
  })
  rest = rest.replace(ANY_URL, raw => { add({ type: 'website', value: cleanUrl(raw) }); return ' ' })
  rest = rest.replace(LABELED_TG, (_, h) => { add({ type: 'telegram', value: h }); return ' ' })
  rest = rest.replace(LABELED_IG, (_, h) => { add({ type: 'instagram', value: h }); return ' ' })
  rest = rest.replace(BARE_HANDLE, (_, h) => { add({ type: 'telegram', value: h }); return ' ' })
  rest = rest.replace(PHONE, m => { if (!isPhone(m)) return m; add({ type: 'phone', value: m.trim().replace(/\s+/g, ' ') }); return ' ' })
  return { rest: rest.replace(/\s+/g, ' ').trim(), channels }
}

/* ---------- Auto tags and cities ---------- */

const kw = (...stems: string[]) => new RegExp(`(?<![\\p{L}\\d])(?:${stems.join('|')})`, 'iu')

const TAG_RULES: [string, RegExp][] = [
  [msg('Investor'), kw('инвест', 'investor', 'венчур', 'venture', 'vc(?![\\p{L}])', 'angel', 'ангел', 'фонд', 'seed', 'private equity', 'family office', 'lp(?![\\p{L}])', 'партнёр фонда', 'партнер фонда')],
  [msg('Business'), kw('основател', 'founder', 'co-?founder', 'ceo(?![\\p{L}])', 'гендир', 'генеральный', 'владел', 'собственник', 'предпринимател', 'бизнесмен', 'миллионер', 'миллиардер', 'владелец', 'топ-менеджер', 'директор', 'президент', 'chairman', 'managing director')],
  [msg('Lawyer'), kw('юрист', 'адвокат', 'lawyer', 'attorney', 'legal', 'правов', 'нотариус', 'counsel')],
  [msg('Finance'), kw('финанс', 'cfo(?![\\p{L}])', 'бухгалтер', 'аудит', 'банкир', 'банк(?![\\p{L}])', 'трейдер', 'trader', 'wealth', 'налог', 'tax(?![\\p{L}])')],
  [msg('Crypto'), kw('крипт', 'crypto', 'blockchain', 'блокчейн', 'web3', 'defi', 'nft', 'токен')],
  [msg('AI'), kw('ai(?![\\p{L}])', 'ии(?![\\p{L}])', 'ml(?![\\p{L}])', 'нейросет', 'машинное обучение', 'machine learning', 'llm', 'gpt', 'data scien')],
  [msg('Development'), kw('разработ', 'developer', 'engineer', 'инженер', 'программист', 'cto(?![\\p{L}])', 'backend', 'frontend', 'fullstack', 'devops', 'архитектор', 'software', 'tech lead', 'тимлид')],
  [msg('Design'), kw('дизайн', 'designer', 'ux(?![\\p{L}])', 'ui(?![\\p{L}])', 'арт-директор', 'art director', 'creative director')],
  [msg('Product'), kw('продакт', 'product', 'cpo(?![\\p{L}])', 'продуктов')],
  [msg('Marketing'), kw('маркет', 'marketing', 'smm', 'growth', 'бренд', 'реклам', 'cmo(?![\\p{L}])', 'контент')],
  [msg('Media'), kw('журналист', 'редактор', 'media', 'медиа', 'блогер', 'инфлюенс', 'influenc', 'forbes', 'пиар', 'pr(?![\\p{L}])', 'издани', 'подкаст', 'ведущ')],
  [msg('HR'), kw('hr(?![\\p{L}])', 'рекрутер', 'рекрутинг', 'recruit', 'talent', 'хедхантер', 'headhunt')],
  [msg('Sales'), kw('sales', 'продаж', 'bizdev', 'bd(?![\\p{L}])', 'business development', 'партнёрств', 'партнерств')],
  [msg('Mentor'), kw('ментор', 'mentor', 'коуч', 'coach', 'консультант', 'consultant', 'advisor', 'adviser', 'советник')],
  [msg('Medicine'), kw('врач', 'доктор', 'doctor', 'медицин', 'клиник', 'healthcare', 'health')],
  [msg('Government'), kw('чиновник', 'депутат', 'госслужб', 'министр', 'правительств', 'government', 'политик', 'мэр', 'администраци', 'сенатор')],
  [msg('Real estate'), kw('недвижим', 'real estate', 'девелопер', 'застройщик', 'риелтор', 'realtor')],
  [msg('Education'), kw('преподав', 'профессор', 'университет', 'edtech', 'образован', 'professor', 'lecturer')],
  [msg('Events'), kw('организатор мероприят', 'ивент', 'event manager', 'конференци', 'спикер', 'speaker')],
]

/** "investors", «инвесторы» → "Investor" (in the interface language); an unknown tag just gets a capital letter. */
export function canonTag(value2: string): string {
  const v = value2.trim()
  if (!v) return v
  const known = v.split(/\s+/).length <= 2 ? autoTags(v, 1)[0] : undefined
  return known ?? v[0].toUpperCase() + v.slice(1)
}

export function autoTags(text: string, max = 3): string[] {
  const out: string[] = []
  for (const [tag, re] of TAG_RULES) {
    if (re.test(text)) out.push(t(tag))
    if (out.length >= max) break
  }
  return out
}

/** Tags the app can suggest — for hints in fields. */
export const suggestedTags = () => TAG_RULES.map(([item]) => t(item))

const CITIES: [string, RegExp][] = [
  [msg('Dubai'), kw('дуба[йеяи]', 'dubai')], [msg('Abu Dhabi'), kw('абу-даби', 'абу даби', 'abu dhabi')], [msg('Moscow'), kw('москв', 'moscow')],
  [msg('Saint Petersburg'), kw('петербург', 'питер', 'spb(?![\\p{L}])', 'st\\.? petersburg')], [msg('London'), kw('лондон', 'london')], [msg('New York'), kw('нью-йорк', 'new york', 'nyc(?![\\p{L}])')],
  [msg('San Francisco'), kw('сан-франциско', 'san francisco', 'sf(?![\\p{L}])', 'кремниев', 'silicon valley')], [msg('Berlin'), kw('берлин', 'berlin')], [msg('Lisbon'), kw('лиссабон', 'lisbon')],
  [msg('Tbilisi'), kw('тбилис', 'tbilisi')], [msg('Yerevan'), kw('ереван', 'yerevan')], [msg('Belgrade'), kw('белград', 'belgrade')], [msg('Istanbul'), kw('стамбул', 'istanbul')],
  [msg('Almaty'), kw('алмат', 'almaty')], [msg('Astana'), kw('астан', 'astana')], [msg('Baku'), kw('баку', 'baku')], [msg('Tashkent'), kw('ташкент', 'tashkent')], [msg('Minsk'), kw('минск', 'minsk')],
  [msg('Kyiv'), kw('киев', 'kyiv', 'kiev')], [msg('Tel Aviv'), kw('тель-авив', 'tel aviv', 'tel-aviv')], [msg('Limassol'), kw('лимассол', 'limassol')], [msg('Bali'), kw('бали(?![\\p{L}])', 'bali')],
  [msg('Bangkok'), kw('бангкок', 'bangkok')], [msg('Singapore'), kw('сингапур', 'singapore')], [msg('Hong Kong'), kw('гонконг', 'hong kong')], [msg('Paris'), kw('париж', 'paris')],
  [msg('Madrid'), kw('мадрид', 'madrid')], [msg('Barcelona'), kw('барселон', 'barcelona')], [msg('Amsterdam'), kw('амстердам', 'amsterdam')], [msg('Milan'), kw('милан', 'milan')],
  [msg('Zurich'), kw('цюрих', 'zurich')], [msg('Geneva'), kw('женев', 'geneva')], [msg('Vienna'), kw('вена(?![\\p{L}])', 'вене(?![\\p{L}])', 'vienna')], [msg('Prague'), kw('праг', 'prague')],
  [msg('Warsaw'), kw('варшав', 'warsaw')], [msg('Riga'), kw('риг[аеи](?![\\p{L}])', 'riga')], [msg('Vilnius'), kw('вильнюс', 'vilnius')], [msg('Tallinn'), kw('таллин', 'tallinn')],
  [msg('Kazan'), kw('казан', 'kazan')], [msg('Yekaterinburg'), kw('екатеринбург', 'yekaterinburg')], [msg('Novosibirsk'), kw('новосибирск', 'novosibirsk')], [msg('Sochi'), kw('сочи(?![\\p{L}])', 'sochi')],
  [msg('Doha'), kw('доха', 'дохе', 'doha')], [msg('Riyadh'), kw('эр-рияд', 'рияд', 'riyadh')], [msg('Mumbai'), kw('мумбаи', 'mumbai')], [msg('Seoul'), kw('сеул', 'seoul')], [msg('Tokyo'), kw('токио', 'tokyo')],
  [msg('Los Angeles'), kw('лос-анджелес', 'los angeles', 'la(?![\\p{L}])')], [msg('Miami'), kw('майами', 'miami')], [msg('Toronto'), kw('торонто', 'toronto')],
]

export function detectCity(text: string): string | undefined {
  for (const [city, re] of CITIES) if (re.test(text)) return t(city)
}

/* ---------- Names ---------- */

const PATRONYMIC = /(ович|евич|ьич|овна|евна|ична|инична|оглы|кызы)$/i
const SURNAME = /(ов|ев|ёв|ин|ын|ский|цкий|ской|ова|ева|ёва|ина|ына|ская|цкая|енко|юк|ук|ич|ко)$/i
const PARTICLE = /^(де|ван|фон|ибн|аль|эль|ди|van|von|de|del|di|al|bin|le|la|st\.?)$/i
const isCap = (w: string) => /^\p{Lu}/u.test(w)
const capitalize = (w: string) => w.split('-').map(p => (p ? p[0].toUpperCase() + p.slice(1) : p)).join('-')
const looksLikeRole = (s: string) => TAG_RULES.some(([, re]) => re.test(s))
const nameWord = (w: string) => /^[\p{L}][\p{L}'’.-]*$/u.test(w)

function fromSlug(slug: string): string | undefined {
  let s = slug
  try { s = decodeURIComponent(slug) } catch { /* noop */ }
  s = s.replace(/[-_]?(?:[0-9a-f]{6,}|\d{2,})$/i, '').replace(/\/$/, '')
  const words = s.split(/[-_.]+/).filter(w => /^\p{L}{2,}$/u.test(w))
  return words.length >= 2 && words.length <= 4 ? words.map(capitalize).join(' ') : undefined
}

function fromHandle(h: string) {
  const words = h.split(/[_.]+/).filter(Boolean)
  return words.map(capitalize).join(' ') || h
}

export function splitFullName(text: string): { first: string; last?: string } {
  const w = text.trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return { first: '' }
  if (w.length === 1) return { first: capitalize(w[0]) }
  if (w.length >= 3 && PATRONYMIC.test(w[2])) return { first: capitalize(w[1]), last: capitalize(w[0]) }
  if (w.length >= 3 && PATRONYMIC.test(w[1])) return { first: capitalize(w[0]), last: capitalize(w[2]) }
  return { first: capitalize(w[0]), last: w.slice(1).map(capitalize).join(' ') }
}

/** The first words of a line that look like a name. The rest is the description. */
function takeName(chunk: string): { first: string; last?: string; leftover: string } | null {
  const words = chunk.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (!words.length) return null
  const allLower = words.every(w => !isCap(w))
  if (allLower && looksLikeRole(words[0])) return null
  const take: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (take.length >= 3 || !nameWord(w)) break
    if (allLower && i > 0 && looksLikeRole(w)) break
    if (i === 0 || isCap(w) || PARTICLE.test(w) || allLower) take.push(w)
    else break
  }
  if (!take.length || !nameWord(take[0])) return null
  const { first, last } = splitFullName(take.join(' '))
  return { first, last, leftover: words.slice(take.length).join(' ') }
}


/* ---------- Free text: one card ---------- */

const SEP = /\s+[—–-]\s+|\s*[|;•·\n\t]\s*|\s*,\s*/

/** "John Smith — fund, Dubai, @john" → a card. Works on a link or a lone @handle too. */
export function parseLeadText(raw: string): ParsedLead {
  const { rest, channels } = extractContacts(raw)
  const extra: string[] = []
  const query = rest.replace(/[(（]([^)）]{1,80})[)）]/g, (_, m: string) => { extra.push(m.trim()); return ' ' })
  const parts = query.split(SEP).map(s => s.trim()).filter(Boolean)

  let first = ''
  let last: string | undefined
  let desc: string[] = []

  const head = parts[0]
  const headLooksLikeName = head && !(channels.length && !isCap(head[0]) && !/^\p{L}+\s\p{L}+$/u.test(head))
  const nm = head && headLooksLikeName ? takeName(head) : null
  if (nm) {
    first = nm.first; last = nm.last
    desc = [nm.leftover, ...parts.slice(1)]
  } else desc = parts
  desc = [...desc, ...extra].filter(Boolean)

  // a name from links, a handle or an email when the text has none
  if (!first) {
    const li = channels.find(c => c.type === 'linkedin')
    const slugName = li ? fromSlug(li.value.replace(/^https?:\/\/(?:www\.)?linkedin\.com\/(?:in|pub)\//i, '')) : undefined
    const em = channels.find(c => c.type === 'email')
    const handle = channels.find(c => c.type === 'telegram' || c.type === 'instagram' || c.type === 'x')
    const emailName = em ? em.value.split('@')[0].split(/[._-]+/).filter(w => /^\p{L}{2,}$/u.test(w)).map(capitalize).join(' ') : ''
    const guess = slugName || (emailName.includes(' ') ? emailName : '') || (handle ? fromHandle(handle.value) : '') || emailName || channels.find(c => c.type === 'phone')?.value || ''
    const sp = isPhone(guess) ? { first: guess, last: undefined } : splitFullName(guess)
    first = sp.first; last = sp.last
  }

  const em = channels.find(c => c.type === 'email')
  const domain = em?.value.split('@')[1]
  const company = domain && !FREE_MAIL.test(domain) ? capitalize(domain.split('.')[0]) : undefined

  const whyText = desc.join(', ')
  const city = detectCity(whyText)
  const whyParts = city ? desc.filter(d => d.trim().toLowerCase() !== city.toLowerCase()) : desc
  return {
    firstName: first || t('No name'),
    lastName: last,
    company,
    city,
    why: whyParts.join(', ') || undefined,
    tags: autoTags(whyText),
    channels,
  }
}

/** A batch of text → cards: one person per line or blocks separated by an empty line. */
export function parseTextList(text: string): ParsedLead[] {
  const norm = text.replace(/\r\n?/g, '\n').trim()
  if (!norm) return []
  const blocks = norm.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
  const strip = (l: string) => l.replace(/^\s*(?:[-•*·–]|\d+[.)])\s+/, '').trim()
  const blockMode = blocks.length >= 2 && blocks.filter(b => b.split('\n').length >= 2).length / blocks.length >= 0.6
  const items = blockMode
    ? blocks.map(b => b.split('\n').map(strip).filter(Boolean).join(' | '))
    : norm.split('\n').map(strip).filter(Boolean)
  return items.map(parseLeadText).filter(p => p.firstName)
}

/* ---------- Spreadsheets ---------- */

export type Role =
  | 'skip' | 'name' | 'fio' | 'first' | 'last' | 'company' | 'role' | 'phone' | 'email' | 'telegram' | 'instagram'
  | 'linkedin' | 'website' | 'city' | 'tags' | 'why' | 'source' | 'notes' | 'contact'

export const ROLE_LABEL: Record<Role, string> = {
  get skip() { return t("Don't import") }, get name() { return t('Name and surname') }, get fio() { return t('Surname, name, patronymic') },
  get first() { return t('First name') }, get last() { return t('Last name') }, get company() { return t('Company') }, get role() { return t('Position') },
  get phone() { return t('Phone') }, get email() { return t('Email') }, telegram: 'Telegram', instagram: 'Instagram', linkedin: 'LinkedIn',
  get website() { return t('Website') }, get city() { return t('City') }, get tags() { return t('Tags') }, get why() { return t('Why valuable') },
  get source() { return t('Source') }, get notes() { return t('Note') }, get contact() { return t('Contacts (any)') },
}
export const ROLE_ORDER: Role[] = ['name', 'first', 'last', 'fio', 'company', 'role', 'phone', 'email', 'telegram', 'instagram', 'linkedin', 'website', 'contact', 'city', 'tags', 'why', 'source', 'notes', 'skip']

const HEADER_RULES: [Role, RegExp][] = [
  ['fio', /^(фио|ф\.?\s?и\.?\s?о\.?|фамилия,?\s+имя(\s+отчество)?)$/i],
  ['name', /(имя\s*(и|,|\/)?\s*фамилия|полное\s+имя|full\s*name|nombre\s+completo|vollst[äa]ndiger\s+name|nom\s+complet|nome\s+completo|повне\s+ім|^name$|^контакт$|^человек$|^участник|^кто$|^contact(\s+name)?$|^персона|^имя\s*контакта)/i],
  ['last', /фамил|прізвищ|last\s*name|surname|family\s*name|lastname|apellido|nachname|familienname|nom\s+de\s+famille|sobrenome/i],
  ['first', /^(имя|ім'?я|first\s*name|given\s*name|firstname|nombre|vorname|pr[ée]nom|primeiro\s*nome)$/i],
  ['email', /e-?mail|почта|пошта|емейл|имейл|электронн|електронн|correo|courriel/i],
  ['phone', /телефон|^тел\b|phone|tel[ée]fono|telefon|t[ée]l[ée]phone|telefone|celular|handy|portable|mobile|мобильн|whatsapp|ватсап|вотсап|номер|^cell|^tel\b/i],
  ['telegram', /telegram|телеграм|телега|^tg$|^тг$|username|юзернейм|^ник/i],
  ['instagram', /instagram|инстаграм|^инста|^insta|^ig$/i],
  ['linkedin', /linkedin|линкедин|^li$/i],
  ['website', /сайт|website|sitio\s+web|webseite|site\s+web|^web$|^url$|ссылка|^link|^site/i],
  ['city', /город|місто|^city|ciudad|^stadt|ville|cidade|locat|локац|страна|country|регион|region|адрес|address|^гео/i],
  ['company', /компан|организац|організац|^org|company|empresa|unternehmen|^firma|entreprise|soci[ée]t[ée]|работодател|место\s+работы|^работа$|employer|startup|стартап|проект|бренд|^фонд$/i],
  ['role', /должност|посад|позици|^title|cargo|puesto|^stelle|^poste|fonction|job\s*title|^role$|position|^роль$|специальност|профессия|occupation/i],
  ['source', /откуда|звідки|источник|джерело|source|origen|fuente|quelle|origem|fonte|где\s+познаком|как\s+познаком|мероприят|^event|referr|рекоменд|от\s+кого/i],
  ['why', /чем\s*(полезен|ценен|занимается)|^why|por\s*qu[ée]|pourquoi|warum|зачем|ценност|специализац|описани|^about$|^bio$|деятельност|профиль|о\s+себе|^summary|expertise|skills|навыки/i],
  ['tags', /^тег|^tags?$|etiquetas|schlagw|[ée]tiquettes|mots-cl[ée]s|label|метк|категор|сфера|отрасл|industry|^тип$|^type$|групп|^group$|vertical|направлен|^area/i],
  ['notes', /коммент|коментар|заметк|нотатк|^note|^nota|notiz|bemerkung|remarques|observa|примеч|comment|remark|^доп/i],
]

export const roleOfHeader = (h: string): Role => {
  const s = h.trim().toLowerCase().replace(/ё/g, 'е')
  if (!s) return 'skip'
  for (const [role, re] of HEADER_RULES) if (re.test(s)) return role
  return 'skip'
}

const isEmailCell = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
const isHandleCell = (s: string) => /^@[A-Za-z]\w{3,31}$/.test(s.trim()) || /(?:t|telegram)\.me\//i.test(s)
const isDataLike = (s: string) => isEmailCell(s) || isPhone(s) || /^@\w{4,}/.test(s.trim()) || /^https?:\/\//i.test(s.trim())

export function detectHeader(rows: string[][]): boolean {
  const r0 = rows[0]
  if (!r0 || rows.length < 2) return false
  const known = r0.filter(c => roleOfHeader(c) !== 'skip').length
  const data = r0.filter(c => c.trim() && isDataLike(c)).length
  return known >= 1 && data === 0
}

/** Column roles: by headers, or by content when there are none. */
export function guessRoles(header: string[] | null, body: string[][]): Role[] {
  const cols = Math.max(header?.length ?? 0, ...body.slice(0, 50).map(r => r.length), 1)
  const roles: Role[] = Array.from({ length: cols }, (_, i) => (header ? roleOfHeader(header[i] ?? '') : 'skip'))

  if (!header) {
    const sample = body.slice(0, 40)
    const col = (i: number) => sample.map(r => (r[i] ?? '').trim()).filter(Boolean)
    const share = (i: number, fn: (s: string) => boolean) => { const c = col(i); return c.length ? c.filter(fn).length / c.length : 0 }
    let nameSet = false
    for (let i = 0; i < cols; i++) {
      if (share(i, isEmailCell) >= 0.5) roles[i] = 'email'
      else if (share(i, isPhone) >= 0.5) roles[i] = 'phone'
      else if (share(i, isHandleCell) >= 0.5) roles[i] = 'telegram'
      else if (share(i, s => /linkedin\.com/i.test(s)) >= 0.5) roles[i] = 'linkedin'
      else if (share(i, s => /^(https?:\/\/|www\.)/i.test(s)) >= 0.5) roles[i] = 'website'
      else if (col(i).length) {
        if (!nameSet) { roles[i] = share(i, s => s.split(/\s+/).length === 3 && PATRONYMIC.test(s.split(/\s+/)[2])) >= 0.5 ? 'fio' : 'name'; nameSet = true }
        else if (!roles.includes('why')) roles[i] = 'why'
        else roles[i] = 'notes'
      }
    }
    return roles
  }

  // a "Name" column without a "Surname" most likely holds the full name
  if (roles.includes('first') && !roles.includes('last') && !roles.includes('name') && !roles.includes('fio')) {
    const i = roles.indexOf('first')
    const c = body.slice(0, 40).map(r => (r[i] ?? '').trim()).filter(Boolean)
    if (c.length && c.filter(s => s.includes(' ')).length / c.length >= 0.4) roles[i] = 'name'
  }
  // duplicate roles (two "Phone" columns) are kept — their values add up; but there is only one name
  for (const r of ['name', 'fio'] as Role[]) {
    const idx = roles.flatMap((x, i) => (x === r ? [i] : []))
    idx.slice(1).forEach(i => { roles[i] = 'skip' })
  }
  return roles
}

const splitList = (s: string) => s.split(/[,;|/\n]+/).map(x => x.trim()).filter(Boolean)
const uniqCI = (a: string[]) => { const seen = new Set<string>(); return a.filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true }) }

export function rowToParsed(row: string[], roles: Role[], opt: { autoTags: boolean }): ParsedLead | null {
  const cells = (r: Role) => roles.flatMap((x, i) => (x === r ? [(row[i] ?? '').trim()] : [])).filter(Boolean)
  const channels: Channel[] = []
  const add = (c: Channel) => { if (c.value && !channels.some(x => x.type === c.type && x.value.toLowerCase() === c.value.toLowerCase())) channels.push(c) }

  const addExtracted = (v: string) => { for (const c of extractContacts(v).channels) add(c.type === 'phone' ? { ...c, value: prettyPhone(c.value) } : c) }
  for (const v of cells('phone')) {
    const before = channels.length
    addExtracted(v)
    if (channels.length === before && digitsOf(v).length >= 7) add({ type: 'phone', value: prettyPhone(v) })
  }
  for (const v of cells('email')) addExtracted(v)
  for (const v of cells('telegram')) { const h = handleFrom(v); if (h && !/\s/.test(h)) add({ type: isPhone(h) ? 'phone' : 'telegram', value: h }) }
  for (const v of cells('instagram')) { const h = handleFrom(v); if (h && !/\s/.test(h)) add({ type: 'instagram', value: h }) }
  for (const v of cells('linkedin')) add({ type: 'linkedin', value: /^https?:/i.test(v) ? cleanUrl(v) : /linkedin\.com/i.test(v) ? `https://${cleanUrl(v)}` : v })
  for (const v of cells('website')) add({ type: 'website', value: cleanUrl(v) })
  for (const v of cells('contact')) addExtracted(v)

  let first = ''
  let last: string | undefined
  const name = cells('name')[0]
  const fio = cells('fio')[0]
  if (name) { const s = splitFullName(name); first = s.first; last = s.last }
  else if (fio) {
    const w = fio.split(/\s+/)
    const swap = (w.length >= 3 && PATRONYMIC.test(w[2])) || (w.length === 2 && SURNAME.test(w[0]) && !SURNAME.test(w[1]))
    if (swap) { first = capitalize(w[1]); last = capitalize(w[0]) } else { const s = splitFullName(fio); first = s.first; last = s.last }
  }
  const f = cells('first')[0]; const l = cells('last')[0]
  if (f) first = f.split(/\s+/).map(capitalize).join(' ')
  if (l) last = l.split(/\s+/).map(capitalize).join(' ')

  let company = cells('company')[0]
  if (!first) {
    const guess = parseLeadText(channels.map(c => (c.type === 'email' ? c.value : c.type === 'telegram' || c.type === 'instagram' ? `@${c.value}` : c.value)).join(' '))
    first = isNoName(guess.firstName) ? '' : guess.firstName
    last = last ?? guess.lastName
    company = company ?? guess.company
    if (!first) first = channels.find(c => c.type === 'phone')?.value ?? ''
  }
  if (!first) return null

  const role = cells('role')[0]
  const why = uniqCI(cells('why')).join('. ') || undefined
  const notes = cells('notes').join('\n') || undefined
  const tagCells = uniqCI(cells('tags').flatMap(splitList).map(canonTag)).slice(0, 6)
  const text = [role, why, company, tagCells.join(' '), notes].filter(Boolean).join(' ')
  const tags = opt.autoTags ? uniqCI([...tagCells, ...autoTags(text, 3)]).slice(0, 6) : tagCells
  const city = cells('city')[0] ?? detectCity(text)
  return { firstName: first, lastName: last, company, role, city, why, notes, source: cells('source')[0], tags, channels }
}

/* ---------- Duplicates ---------- */

const normName = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\d ]+/gu, ' ').replace(/\s+/g, ' ').trim()

type Keyed = { firstName: string; lastName?: string; channels: Channel[] }

/** Identity keys: phone, email, handle, link, full name. Any match means the same person. */
export function leadKeys(p: Keyed): string[] {
  const keys: string[] = []
  for (const c of p.channels) {
    const v = c.value.trim().toLowerCase()
    if (!v) continue
    if (c.type === 'phone' || c.type === 'whatsapp') { const d = digitsOf(v); if (d.length >= 10) keys.push(`p:${d.slice(-10)}`) }
    else if (c.type === 'email') keys.push(`e:${v}`)
    else if (c.type === 'linkedin') keys.push(`l:${v.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}`)
    else keys.push(`${c.type[0]}:${v.replace(/^@/, '')}`)
  }
  const n = normName(`${p.firstName} ${p.lastName ?? ''}`)
  if (p.lastName || n.includes(' ')) keys.push(`n:${n.split(' ').sort().join(' ')}`)
  return keys
}

export type DupKind = 'new' | 'lead' | 'person' | 'file'

export interface Classified { parsed: ParsedLead; kind: DupKind; matchId?: string; matchName?: string }

export function classify(list: ParsedLead[], leads: Lead[], people: Person[]): Classified[] {
  const leadIdx = new Map<string, Lead>()
  for (const l of leads) for (const k of leadKeys(l)) leadIdx.set(k, l)
  const personIdx = new Map<string, Person>()
  for (const p of people) for (const k of leadKeys(p)) personIdx.set(k, p)
  const seen = new Set<string>()
  return list.map(parsed => {
    const keys = leadKeys(parsed)
    const l = keys.map(k => leadIdx.get(k)).find(Boolean)
    if (l) return { parsed, kind: 'lead', matchId: l.id, matchName: fullName(l) }
    const p = keys.map(k => personIdx.get(k)).find(Boolean)
    if (p) return { parsed, kind: 'person', matchId: p.id, matchName: fullName(p) }
    if (keys.some(k => seen.has(k))) return { parsed, kind: 'file' }
    for (const k of keys) seen.add(k)
    return { parsed, kind: 'new' }
  })
}

/* ---------- Assembly ---------- */

export function toLead(p: ParsedLead, extra: { tags?: string[]; source?: string; batchId?: string; createdAt?: number } = {}): Lead {
  const now = extra.createdAt ?? Date.now()
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    firstName: p.firstName,
    lastName: p.lastName || undefined,
    company: p.company || undefined,
    role: p.role || undefined,
    city: p.city || undefined,
    why: p.why || undefined,
    source: p.source || extra.source || undefined,
    tags: uniqCI([...(extra.tags ?? []).map(canonTag), ...p.tags]).slice(0, 8),
    channels: p.channels,
    notes: p.notes || undefined,
    batchId: extra.batchId,
  }
}

export const leadText = (l: Pick<Lead, 'firstName' | 'lastName' | 'company' | 'role' | 'city' | 'why' | 'source' | 'notes' | 'tags' | 'channels'>) =>
  [l.firstName, l.lastName, l.company, l.role, l.city, l.why, l.source, l.notes, ...l.tags, ...l.channels.map(c => c.value)].filter(Boolean).join(' ')
