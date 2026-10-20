import { db } from './db'
import type { Channel, ID, Interaction, Person } from './types'
import { skeleton, normalize } from '@/lib/names'
import { fullName } from '@/lib/format'
import { t, collate } from '@/i18n'

/** Телефоны сравниваем по цифрам, ники и почту — без регистра и @. */
export const channelKey = (c: Channel): string => {
  const v = c.value.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  return c.type === 'phone' || c.type === 'whatsapp' ? `tel:${v.replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7')}` : `${c.type === 'telegram' ? 'tg' : c.type}:${v}`
}

export interface DuplicateGroup { people: Person[]; reasons: string[] }

const fullSkeleton = (p: Pick<Person, 'firstName' | 'lastName'>) => [p.firstName, p.lastName ?? ''].map(skeleton).filter(Boolean).sort().join(' ')

/**
 * Возможные дубли: одно и то же полное имя (в том числе Alexey Petrov = Алексей Петров),
 * или общий телефон, почта, ник. Один человек не бывает в двух группах — группы склеиваются.
 */
export function findDuplicates(all: Person[]): DuplicateGroup[] {
  const people = all.filter(p => !p.familyOf)
  const parent = new Map<ID, ID>(people.map(p => [p.id, p.id]))
  const find = (x: ID): ID => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r }
  const union = (a: ID, b: ID) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  const reasons = new Map<ID, Set<string>>()
  const note = (ids: ID[], why: string) => { for (const id of ids) reasons.set(id, (reasons.get(id) ?? new Set()).add(why)) }

  const bucket = (keyOf: (p: Person) => string[], why: string, minLen = 1) => {
    const m = new Map<string, Person[]>()
    for (const p of people) for (const k of new Set(keyOf(p))) if (k.length >= minLen) m.set(k, [...(m.get(k) ?? []), p])
    for (const list of m.values()) {
      if (list.length < 2) continue
      for (let i = 1; i < list.length; i++) union(list[0]!.id, list[i]!.id)
      note(list.map(p => p.id), why)
    }
  }
  // имя из одного слова слишком общее («Саша»): совпадение по имени требует фамилии
  bucket(p => (p.lastName?.trim() ? [fullSkeleton(p)] : []), t('same first and last name'))
  bucket(p => p.channels.map(channelKey).filter(k => !/^(website|other):/.test(k) && k.length > 6), t('shared contact'))

  const groups = new Map<ID, Person[]>()
  for (const p of people) groups.set(find(p.id), [...(groups.get(find(p.id)) ?? []), p])
  return [...groups.values()].filter(g => g.length > 1).map(g => ({
    people: g.sort((a, b) => b.updatedAt - a.updatedAt),
    reasons: [...new Set(g.flatMap(p => [...(reasons.get(p.id) ?? [])]))],
  })).sort((a, b) => b.people.length - a.people.length || collate(fullName(a.people[0]!), fullName(b.people[0]!)))
}

const uniqBy = <T,>(xs: T[], key: (x: T) => string) => { const seen = new Set<string>(); return xs.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true }) }

/** Чистое слияние полей: оставляем заполненное у главной карточки, недостающее берём у остальных. */
export function mergeFields(keep: Person, others: Person[]): Person {
  const out: Person = { ...keep }
  const text = ['lastName', 'nickname', 'photo', 'company', 'role', 'city', 'birthday', 'metAt', 'metPlace', 'metStory', 'family', 'canHelpMe', 'iCanHelp', 'lookingFor', 'giftIdeas', 'introducedBy', 'cadenceDays', 'relation', 'familyOf'] as const
  for (const o of others) {
    for (const k of text) if ((out[k] === undefined || out[k] === '') && o[k] !== undefined && o[k] !== '') (out as unknown as Record<string, unknown>)[k] = o[k]
    out.circleIds = [...new Set([...out.circleIds, ...o.circleIds])]
    out.tags = [...new Set([...out.tags, ...o.tags])]
    out.channels = uniqBy([...out.channels, ...o.channels], channelKey)
    out.facts = uniqBy([...out.facts, ...o.facts], f => normalize(f.text))
    out.topics = uniqBy([...out.topics, ...o.topics], item => normalize(item.text))
    out.links = uniqBy([...out.links, ...o.links].filter(l => l.personId !== keep.id && l.personId !== o.id), l => l.personId)
    out.importantDates = uniqBy([...(out.importantDates ?? []), ...(o.importantDates ?? [])], d => `${d.kind}|${d.date}|${normalize(d.label)}`)
    if (!out.importantDates.length) delete out.importantDates
    out.prefs = { ...(o.prefs ?? {}), ...(out.prefs ?? {}) }
    if (!Object.keys(out.prefs).length) delete out.prefs
    if (o.notes?.trim() && o.notes.trim() !== out.notes?.trim()) out.notes = [out.notes?.trim(), o.notes.trim()].filter(Boolean).join('\n\n')
    out.pinned = out.pinned || o.pinned
    out.closeness = Math.min(out.closeness, o.closeness) as Person['closeness']
    out.lastContactAt = Math.max(out.lastContactAt ?? 0, o.lastContactAt ?? 0) || undefined
    out.createdAt = Math.min(out.createdAt, o.createdAt)
    if (!out.lifeStatus && o.lifeStatus === undefined) { /* остаётся активным */ }
    out.everyday = out.everyday || o.everyday || undefined
    if (out.nickname === undefined && o.firstName.toLowerCase() !== out.firstName.toLowerCase() && normalize(o.firstName) !== normalize(out.firstName)) out.nickname = o.firstName
  }
  out.updatedAt = Date.now()
  return out
}

const swap = (ids: ID[], gone: Set<ID>, keep: ID) => [...new Set(ids.map(i => (gone.has(i) ? keep : i)))]

/**
 * Объединяет карточки: все записи общения, напоминания, списки, семья и связи переезжают на главную,
 * лишние карточки удаляются. Всё в одной транзакции.
 */
export async function mergePeople(keepId: ID, mergeIds: ID[]): Promise<Person> {
  const gone = new Set(mergeIds.filter(i => i !== keepId))
  let result!: Person
  await db.transaction('rw', db.people, db.interactions, db.reminders, db.collections, db.intros, async () => {
    const keep = await db.people.get(keepId)
    if (!keep) throw new Error(t('Main card not found'))
    const others = (await db.people.bulkGet([...gone])).filter((p): p is Person => !!p)
    result = mergeFields(keep, others)
    await db.people.put(result)

    for (const it of await db.interactions.filter(i => i.personIds.some(p => gone.has(p))).toArray()) {
      await db.interactions.put({ ...it, personIds: swap(it.personIds, gone, keepId) } as Interaction)
    }
    for (const r of await db.reminders.filter(x => !!x.personId && gone.has(x.personId)).toArray()) await db.reminders.update(r.id, { personId: keepId })
    for (const c of await db.collections.filter(x => x.personIds.some(p => gone.has(p))).toArray()) {
      await db.collections.update(c.id, { personIds: swap(c.personIds, gone, keepId), updatedAt: Date.now() })
    }
    for (const p of await db.people.filter(x => x.id !== keepId && !gone.has(x.id) && (x.familyOf !== undefined && gone.has(x.familyOf) || x.introducedBy !== undefined && gone.has(x.introducedBy) || x.links.some(l => gone.has(l.personId)))).toArray()) {
      await db.people.update(p.id, {
        familyOf: p.familyOf && gone.has(p.familyOf) ? keepId : p.familyOf,
        introducedBy: p.introducedBy && gone.has(p.introducedBy) ? keepId : p.introducedBy,
        links: uniqBy(p.links.map(l => (gone.has(l.personId) ? { ...l, personId: keepId } : l)).filter(l => l.personId !== p.id), l => l.personId),
        updatedAt: Date.now(),
      })
    }
    for (const x of await db.intros.filter(i => gone.has(i.aId) || gone.has(i.bId)).toArray()) {
      const a = gone.has(x.aId) ? keepId : x.aId
      const b = gone.has(x.bId) ? keepId : x.bId
      if (a === b) await db.intros.delete(x.id)
      else await db.intros.update(x.id, { aId: a, bId: b })
    }
    await db.people.bulkDelete([...gone])
    // последний контакт пересчитываем по объединённой истории
    const ints = await db.interactions.where('personIds').equals(keepId).toArray()
    const last = ints.filter(i => ['meeting', 'call', 'message', 'event', 'favor_given', 'favor_got', 'gift'].includes(i.type)).reduce((m, i) => Math.max(m, i.date), 0)
    result = { ...result, lastContactAt: last || undefined }
    await db.people.put(result)
  })
  return result
}

/** Массовая правка: меняет только то, что указано. Теги добавляются, а не заменяются. */
export interface BulkPatch {
  city?: string
  metPlace?: string
  company?: string
  closeness?: Person['closeness']
  addTags?: string[]
  addCircleIds?: ID[]
  removeCircleIds?: ID[]
  lifeStatus?: Person['lifeStatus'] | null
  cadenceDays?: number | null
  archived?: boolean
}

export async function bulkPatchPeople(ids: ID[], patch: BulkPatch): Promise<number> {
  let n = 0
  await db.transaction('rw', db.people, async () => {
    for (const p of (await db.people.bulkGet(ids)).filter((x): x is Person => !!x)) {
      const next: Person = { ...p, updatedAt: Date.now() }
      if (patch.city !== undefined) next.city = patch.city.trim() || undefined
      if (patch.metPlace !== undefined) next.metPlace = patch.metPlace.trim() || undefined
      if (patch.company !== undefined) next.company = patch.company.trim() || undefined
      if (patch.closeness !== undefined) next.closeness = patch.closeness
      if (patch.addTags?.length) next.tags = [...new Set([...next.tags, ...patch.addTags])]
      if (patch.addCircleIds?.length) next.circleIds = [...new Set([...next.circleIds, ...patch.addCircleIds])]
      if (patch.removeCircleIds?.length) next.circleIds = next.circleIds.filter(c => !patch.removeCircleIds!.includes(c))
      if (patch.lifeStatus !== undefined) { next.lifeStatus = patch.lifeStatus ?? undefined; next.lifeStatusAt = patch.lifeStatus ? Date.now() : undefined }
      if (patch.cadenceDays !== undefined) next.cadenceDays = patch.cadenceDays ?? undefined
      if (patch.archived !== undefined) next.archived = patch.archived || undefined
      await db.people.put(next)
      n++
    }
  })
  return n
}
