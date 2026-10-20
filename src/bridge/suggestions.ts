import { db } from '@/data/db'
import { recomputeLastContact } from '@/data/actions'
import { DAY } from '@/lib/format'
import type { FactIcon, Interaction, InteractionType } from '@/data/types'
import { buildLinkMap } from './cycle'
import { bridgeMeta as dbMeta, META, type PeerCaptures, type PeerFacts } from './cache'
import type { LinkRow } from './protocol'
import { t } from '@/i18n'

/** Что Орбита предлагает добавить в Aster. Предложения не применяются сами: человек подтверждает. */
export interface Suggestion {
  id: string
  /** ключ записи или факта в Орбите */
  key: string
  kind: 'capture' | 'fact'
  personId: string
  personName: string
  title: string
  text?: string
  day?: string
  place?: string
  type?: InteractionType
}

export const bridgeMeta = dbMeta

const dayMs = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d, 12).getTime() : Date.now()
}

const TYPE: Record<string, InteractionType> = { meeting: 'meeting', call: 'call', message: 'message', note: 'note' }
const WINDOW_DAYS = 120

export const captureInteractionId = (key: string) => `bridge-cap-${key}`

async function linkMap() {
  const rows = (await dbMeta.get<LinkRow[]>('links')) ?? []
  return buildLinkMap(rows)
}

/** Собирает предложения из кэшей Орбиты: только про людей, которые связаны, и только ещё не обработанные. */
export async function listSuggestions(now = Date.now()): Promise<Suggestion[]> {
  const [captures, facts, links, settings, people] = await Promise.all([
    dbMeta.get<PeerCaptures>(META.captures),
    dbMeta.get<PeerFacts>(META.facts),
    linkMap(),
    db.settings.get('me'),
    db.people.toArray(),
  ])
  const handled = new Set(settings?.bridgeHandled ?? [])
  const byId = new Map(people.map(p => [p.id, p]))
  const out: Suggestion[] = []

  for (const [key, c] of Object.entries(captures ?? {})) {
    if (dayMs(c.day) < now - WINDOW_DAYS * DAY) continue
    for (const ref of c.people) {
      const localId = links.byPeer.get(ref.ref)
      const p = localId ? byId.get(localId) : undefined
      if (!p || p.archived) continue
      const id = `cap:${key}:${p.id}`
      if (handled.has(id)) continue
      out.push({ id, key, kind: 'capture', personId: p.id, personName: p.firstName, title: c.title || t('Record from Orbita'), text: c.summary, day: c.day, place: c.place, type: TYPE[c.kind] ?? 'note' })
    }
  }
  for (const [key, f] of Object.entries(facts ?? {})) {
    for (const ref of f.people) {
      const localId = links.byPeer.get(ref.ref)
      const p = localId ? byId.get(localId) : undefined
      if (!p || p.archived) continue
      if (p.facts.some(x => x.text.toLowerCase() === f.title.toLowerCase())) continue
      const id = `fact:${key}:${p.id}`
      if (handled.has(id)) continue
      out.push({ id, key, kind: 'fact', personId: p.id, personName: p.firstName, title: f.title, text: f.body })
    }
  }
  return out.sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''))
}

async function markHandled(ids: string[]) {
  await db.transaction('rw', db.settings, async () => {
    const s = await db.settings.get('me')
    if (!s) return
    await db.settings.put({ ...s, bridgeHandled: [...new Set([...(s.bridgeHandled ?? []), ...ids])].slice(-1000) })
  })
}

/** Запись из Орбиты → взаимодействие в хронологии. id детерминированный: на втором устройстве дубля не будет. */
export async function acceptSuggestion(s: Suggestion): Promise<void> {
  if (s.kind === 'capture') {
    const it: Interaction = { id: captureInteractionId(`${s.key}-${s.personId}`), personIds: [s.personId], type: s.type ?? 'note', date: dayMs(s.day ?? ''), title: s.title, note: s.text, place: s.place, createdAt: Date.now(), bridgeKey: s.key }
    await db.interactions.put(it)
    await recomputeLastContact(s.personId)
  } else {
    const p = await db.people.get(s.personId)
    if (p && !p.facts.some(x => x.text.toLowerCase() === s.title.toLowerCase())) {
      const icon: FactIcon = 'sparkle'
      await db.people.update(s.personId, { facts: [...p.facts, { icon, text: s.title }], updatedAt: Date.now() })
    }
  }
  await markHandled([s.id])
}

export async function dismissSuggestion(s: Suggestion): Promise<void> {
  await markHandled([s.id])
}
