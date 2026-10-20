import { db } from '@/data/db'
import { fullName } from '@/lib/format'
import { DAY } from '@/lib/format'
import type { Person, Reminder } from '@/data/types'
import { buildLinkMap, type ApplyContext, type ApplyResult, type BridgeAdapter, type LinkMap, type MetaStore } from './cycle'
import { matchPeople } from './match'
import { META, peerToNamed, toNamed, type PeerCaptures, type PeerFacts, type PeerPeople, type PeerStats } from './cache'
import type { CaptureData, CommitmentData, FactData, FeedItem, LinkRow, PersonData, PersonStatsData, PulledItem } from './protocol'
import { t } from '@/i18n'

const personName = (p: Pick<Person, 'firstName' | 'lastName'>) => fullName(p)

/** The id of a mirrored reminder: the same on all devices, so no duplicates appear. */
export const mirrorId = (commitmentKey: string) => `bridge-${commitmentKey}`

/* ---------- publishing ---------- */

async function collect(links: LinkMap): Promise<FeedItem[]> {
  const settings = await db.settings.get('me')
  // fictional data does not go to the other app
  if (settings?.demo) return []

  const out: FeedItem[] = []
  const [people, interactions, reminders] = await Promise.all([db.people.toArray(), db.interactions.toArray(), db.reminders.toArray()])

  const counts = new Map<string, number>()
  for (const it of interactions) for (const pid of it.personIds) counts.set(pid, (counts.get(pid) ?? 0) + 1)
  const blockedLocal = new Set(links.blocked.map(b => b.localId))

  for (const p of people) {
    if (p.familyOf) continue // family does not go to the other app
    const peerRef = links.byLocal.get(p.id) ?? (blockedLocal.has(p.id) ? null : undefined)
    const data: PersonData = { name: personName(p), aliases: p.nickname ? [p.nickname] : [], ...(p.archived ? { archived: true } : {}), ...(peerRef !== undefined ? { peerRef } : {}) }
    out.push({ entity: 'person', key: p.id, data: data as unknown as Record<string, unknown>, deleted: false, updated_ms: p.updatedAt })
    if (!p.archived) {
      const stats: PersonStatsData = { closeness: p.closeness, interactions: counts.get(p.id) ?? 0, ...(p.lastContactAt ? { lastContactAt: p.lastContactAt } : {}) }
      out.push({ entity: 'person_stats', key: p.id, data: stats as unknown as Record<string, unknown>, deleted: false })
    }
  }

  for (const r of reminders) {
    if (!r.bridgeKey) continue
    out.push({
      entity: 'commitment_state',
      key: r.bridgeKey,
      data: { status: r.done ? 'done' : 'open', ...(r.doneAt ? { doneMs: r.doneAt } : {}) },
      deleted: false,
      updated_ms: r.updatedAt ?? r.doneAt ?? r.createdAt,
    })
  }
  return out
}

/* ---------- applying ---------- */

async function loadCache<T>(meta: MetaStore, key: string): Promise<T> {
  return ((await meta.get<T>(key)) ?? {}) as T
}

async function apply(rows: PulledItem[], ctx: ApplyContext): Promise<ApplyResult> {
  const { meta, links, now } = ctx
  const peerPeople = await loadCache<PeerPeople>(meta, META.people)
  const peerStats = await loadCache<PeerStats>(meta, META.stats)
  const captures = await loadCache<PeerCaptures>(meta, META.captures)
  const facts = await loadCache<PeerFacts>(meta, META.facts)
  const settings = await db.settings.get('me')
  const handled = new Set(settings?.bridgeHandled ?? [])
  const linkRows: LinkRow[] = []
  let changed = 0
  let peopleTouched = false

  const myLinkRow = (localId: string) => links.rows.find(r => r.local_id === localId)

  for (const row of rows) {
    const d = row.data
    switch (row.entity) {
      case 'person': {
        peopleTouched = true
        if (row.deleted || !d) { delete peerPeople[row.key]; break }
        const data = d as unknown as PersonData
        peerPeople[row.key] = { ...data, ms: row.updated_ms }
        // the other side has already linked their person to mine: accept the link
        if (typeof data.peerRef === 'string') {
          const mine = myLinkRow(data.peerRef)
          if (!links.byLocal.has(data.peerRef) && !links.byPeer.has(row.key) && (!mine || row.updated_ms > mine.updated_ms) && (await db.people.get(data.peerRef))) {
            linkRows.push({ local_id: data.peerRef, peer_id: row.key, origin: 'user', deleted: false, updated_ms: row.updated_ms })
          }
        } else if (data.peerRef === null) {
          // the other side explicitly broke the link: accept it if it is newer than mine
          const localId = links.byPeer.get(row.key)
          const mine = localId ? myLinkRow(localId) : undefined
          if (localId && mine && !mine.deleted && row.updated_ms > mine.updated_ms) {
            linkRows.push({ local_id: localId, peer_id: row.key, origin: 'user', deleted: true, updated_ms: row.updated_ms })
          }
        }
        break
      }
      case 'person_stats': {
        if (row.deleted || !d) delete peerStats[row.key]
        else peerStats[row.key] = d as unknown as PersonStatsData
        break
      }
      case 'commitment': {
        changed += await mirrorCommitment(row, links, handled, now)
        break
      }
      case 'capture': {
        if (row.deleted || !d) delete captures[row.key]
        else captures[row.key] = { ...(d as unknown as CaptureData), ms: row.updated_ms }
        break
      }
      case 'fact': {
        if (row.deleted || !d) delete facts[row.key]
        else facts[row.key] = { ...(d as unknown as FactData), ms: row.updated_ms }
        break
      }
      default:
        break // commitment_state is read by Orbita, not by us
    }
  }

  await meta.set(META.people, peerPeople)
  await meta.set(META.stats, peerStats)
  await meta.set(META.captures, captures)
  await meta.set(META.facts, facts)

  if (peopleTouched) {
    const local = await db.people.toArray()
    const have = linkRows.filter(l => !l.deleted)
    const linked = [...links.rows.filter(r => !r.deleted).map(r => ({ localId: r.local_id, peerId: r.peer_id })), ...have.map(l => ({ localId: l.local_id, peerId: l.peer_id }))]
    const { auto } = matchPeople(toNamed(local), peerToNamed(peerPeople), linked, links.blocked, { candidates: false })
    for (const m of auto) linkRows.push({ local_id: m.localId, peer_id: m.peerId, origin: 'auto', deleted: false, updated_ms: now })
  }
  return { links: linkRows, changed }
}

/** A commitment from Orbita → a reminder in Aster. The side whose edit is newer wins. */
async function mirrorCommitment(row: PulledItem, links: LinkMap, handled: Set<string>, now: number): Promise<number> {
  const id = mirrorId(row.key)
  const existing = await db.reminders.get(id)

  if (row.deleted || !row.data) {
    if (existing) { await db.reminders.delete(id); return 1 }
    return 0
  }
  const d = row.data as unknown as CommitmentData
  if (handled.has(`rem:${row.key}`)) return 0 // the person deleted this reminder: we do not bring it back

  const personId = d.personRef ? links.byPeer.get(d.personRef) : undefined
  const text = d.direction === 'owed_to_me' ? t('Waiting for: {title}', { title: d.title }) : d.title
  const created = d.createdMs ?? now
  const dueAt = d.dueMs ?? created + 7 * DAY
  const done = d.status !== 'open'

  if (!existing) {
    const rem: Reminder = { id, personId, text, dueAt, done, doneAt: done ? (d.doneMs ?? row.updated_ms) : undefined, createdAt: created, updatedAt: row.updated_ms, bridgeKey: row.key }
    await db.reminders.put(rem)
    return 1
  }

  const mine = existing.updatedAt ?? existing.doneAt ?? existing.createdAt
  if (row.updated_ms > mine) {
    const next: Reminder = { ...existing, personId: personId ?? existing.personId, text, dueAt, done, doneAt: done ? (d.doneMs ?? existing.doneAt ?? row.updated_ms) : undefined, updatedAt: row.updated_ms }
    if (JSON.stringify(next) === JSON.stringify(existing)) return 0
    await db.reminders.put(next)
    return 1
  }
  // the edit here is newer: we only add the link to the person if one appeared
  if (!existing.personId && personId) {
    await db.reminders.update(id, { personId })
    return 1
  }
  return 0
}

export const asterAdapter: BridgeAdapter = { collect, apply }
export { buildLinkMap }
