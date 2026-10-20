import type { FamilyRelation, ID, Person } from './types'
import { blankPerson } from './actions'
import { db } from './db'
import { t, collate, intlTag } from '@/i18n'

/** Подписи без родов: «Партнёр», «Ребёнок». Конкретнее — в самой записи (имя и роль в описании). */
export const RELATION_LABEL: Record<FamilyRelation, string> = {
  get partner() { return t('Partner') },
  get child() { return t('Child') },
  get parent() { return t('Parent') },
  get sibling() { return t('Sibling') },
  get relative() { return t('Relative') },
}

export const RELATION_ORDER: FamilyRelation[] = ['partner', 'child', 'parent', 'sibling', 'relative']

export const RELATION_EMOJI: Record<FamilyRelation, string> = { partner: '💞', child: '🧒', parent: '🏡', sibling: '🤝', relative: '🌳' }

/** «Ребёнок Алины», «Партнёр Марка» — подпись для списков, где семья смешана с остальными. */
export function relationPhrase(member: Person, owner?: Person): string {
  const rel = member.relation ? RELATION_LABEL[member.relation] : t('Close friend')
  return owner ? `${rel} · ${owner.firstName}` : rel
}

export const isFamilyMember = (p: Person): boolean => !!p.familyOf

/** Семья человека в удобном порядке: партнёр, дети (старшие первыми), родители, братья и сёстры, остальные. */
export function familyOfPerson(all: Person[], ownerId: ID): Person[] {
  const members = all.filter(p => p.familyOf === ownerId)
  const rank = (p: Person) => RELATION_ORDER.indexOf(p.relation ?? 'relative')
  const year = (p: Person) => Number(p.birthday?.match(/^(\d{4})/)?.[1] ?? 9999)
  return members.sort((a, b) => rank(a) - rank(b) || year(a) - year(b) || collate(a.firstName, b.firstName))
}

/** Возраст на сегодня по дню рождения с годом; без года — null. */
export function ageOf(birthday: string | undefined, now = Date.now()): number | null {
  const m = birthday?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  const date = new Date(now)
  let age = date.getFullYear() - y
  if (date.getMonth() < mo || (date.getMonth() === mo && date.getDate() < d)) age--
  return age >= 0 ? age : null
}

/* ---------- разбор старого текстового поля «Семья» ---------- */

export interface ParsedMember { name: string; relation: FamilyRelation; age?: number }

const REL_WORDS: Array<[RegExp, FamilyRelation]> = [
  [/^(муж|жена|супруг\w*|партн[её]р\w*|девушк\w*|парень|парня|любим\w+|невест\w*|жених|wife|husband|spouse|partner|girlfriend|boyfriend|fianc[ée]e?)$/i, 'partner'],
  [/^(сын|сына|дочь|дочка|дочери|дочку|ребён\w+|ребен\w+|малыш\w*|son|daughter|child|kid|baby)$/i, 'child'],
  [/^(мама|мать|мамы|папа|отец|папы|родител\w+|тест[ьи]|свекр\w+|тёща|теща|mom|mum|mother|dad|father|parents?|stepmother|stepfather)$/i, 'parent'],
  [/^(брат|сестра|сестр[ауы]|брата|братом|brother|sister|sibling)$/i, 'sibling'],
  [/^(бабушк\w+|дедушк\w+|дед|баба|т[её]тя|дядя|племянни\w+|кузен\w*|кузина|двоюродн\w+|внук\w*|внучк\w+|grand(?:ma|pa|mother|father|son|daughter|parent)|aunt|uncle|cousin|nephew|niece)$/i, 'relative'],
]

const AGE_UNIT = '(?:лет|года|год|г\\.?|years?(?:\\s+old)?|yrs?|y\\.?o\\.?)'
const AGE = new RegExp(`\\(?(\\d{1,2})\\s*${AGE_UNIT}\\)?`, 'i')
const AGE_G = new RegExp(AGE.source, 'gi')
/** An age in brackets with no unit: "Eve (4)" */
const BARE_AGE = /\((\d{1,2})\)/
const BARE_AGE_G = /\(\d{1,2}\)/g

/**
 * «Жена Маша, сын Лёва (5 лет), мама Ольга» → список. Берём только то, что понятно: слово родства + имя.
 * Остальное вернём вызывающему как нераспознанное — человек решит сам.
 */
export function parseFamilyText(text: string): { members: ParsedMember[]; rest: string[] } {
  const members: ParsedMember[] = []
  const rest: string[] = []
  for (const raw of text.split(/[,;\n]|\s+(?:и|and)\s+(?=[а-яёА-ЯЁA-Za-z])/)) {
    const part = raw.trim()
    if (!part) continue
    const age = part.match(AGE) ?? part.match(BARE_AGE)
    const cleaned = part.replace(AGE_G, '').replace(BARE_AGE_G, '').replace(/[()]/g, '').trim()
    const [first, ...tail] = cleaned.split(/\s+/)
    const rel = first ? REL_WORDS.find(([re]) => re.test(first))?.[1] : undefined
    const name = tail.join(' ').replace(/[.:]+$/, '').trim()
    if (rel && /^[А-ЯЁA-Z]/.test(name)) members.push({ name, relation: rel, ...(age ? { age: Number(age[1]) } : {}) })
    else rest.push(part)
  }
  return { members, rest }
}

/* ---------- запись в базу ---------- */

export interface NewMember { firstName: string; lastName?: string; relation: FamilyRelation; birthday?: string; notes?: string }

/** Создаёт члена семьи как отдельного человека: у него свой день рождения и своя карточка. */
export async function addFamilyMember(ownerId: ID, m: NewMember): Promise<ID> {
  const owner = await db.people.get(ownerId)
  const p = blankPerson({
    firstName: m.firstName.trim(),
    lastName: m.lastName?.trim() || (m.relation === 'partner' ? undefined : owner?.lastName),
    familyOf: ownerId,
    relation: m.relation,
    birthday: m.birthday || undefined,
    notes: m.notes,
    closeness: 1,
  })
  await db.people.put(p)
  return p.id
}

/**
 * Превращает текст «семья» в карточки. Возраст без даты рождения сохраняется как заметка,
 * потому что выдумывать дату нельзя.
 */
export async function convertFamilyText(ownerId: ID, now = Date.now()): Promise<{ created: number; rest: string }> {
  const owner = await db.people.get(ownerId)
  if (!owner?.family) return { created: 0, rest: '' }
  const { members, rest } = parseFamilyText(owner.family)
  const existing = (await db.people.filter(x => x.familyOf === ownerId).toArray()).map(p => p.firstName.toLowerCase())
  let created = 0
  for (const m of members) {
    if (existing.includes(m.name.split(' ')[0]!.toLowerCase())) continue
    const [firstName, ...last] = m.name.split(' ')
    await addFamilyMember(ownerId, {
      firstName: firstName!, lastName: last.join(' ') || undefined, relation: m.relation,
      notes: m.age !== undefined ? t("Age on {toLocaleDateString}: {age}. Add a birth date so you don't miss the birthday.", { toLocaleDateString: new Date(now).toLocaleDateString(intlTag()), age: m.age }) : undefined,
    })
    created++
  }
  await db.people.update(ownerId, { family: rest.length ? rest.join(', ') : undefined, updatedAt: Date.now() })
  return { created, rest: rest.join(', ') }
}
