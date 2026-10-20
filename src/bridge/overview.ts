import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/data/db'
import type { Person } from '@/data/types'
import { bridgeMeta, META, peerToNamed, toNamed, type PeerPeople, type PeerStats } from './cache'
import { buildLinkMap } from './cycle'
import { matchPeople, type Candidate } from './match'
import type { LinkRow } from './protocol'

/** Состояние сопоставления людей для экрана: связи, предложения и «не нашли пары». */
export async function peopleOverview() {
  const [peers, stats, linksRows, people] = await Promise.all([
    bridgeMeta.get<PeerPeople>(META.people),
    bridgeMeta.get<PeerStats>(META.stats),
    bridgeMeta.get<LinkRow[]>('links'),
    db.people.toArray(),
  ])
  const links = buildLinkMap(linksRows ?? [])
  const peerMap = peers ?? {}
  const linked = [...links.byLocal.entries()].map(([localId, peerId]) => ({ localId, peerId }))
  const { candidates } = matchPeople(toNamed(people), peerToNamed(peerMap), linked, links.blocked)
  const byId = new Map(people.map(p => [p.id, p]))
  return {
    peerCount: Object.keys(peerMap).length,
    stats: stats ?? {},
    peers: peerMap,
    linked: linked.flatMap(l => { const p = byId.get(l.localId); const q = peerMap[l.peerId]; return p ? [{ ...l, person: p, peerName: q?.name ?? '—' }] : [] }),
    candidates: candidates.flatMap((c: Candidate) => { const p = byId.get(c.localId); const q = peerMap[c.peerId]; return p && q ? [{ ...c, person: p as Person, peerName: q.name }] : [] }),
  }
}

export const usePeopleOverview = () => useLiveQuery(() => peopleOverview(), [])
