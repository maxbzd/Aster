import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/data/db'
import { META, type PeerStats } from './cache'
import { buildLinkMap } from './cycle'
import type { LinkRow, PersonStatsData } from './protocol'
import { listSuggestions, type Suggestion } from './suggestions'

export const useSuggestions = (): Suggestion[] => useLiveQuery(() => listSuggestions(), []) ?? []

/** Что про этого человека знает Орбита (если он связан). */
export function usePeerStats(personId?: string): PersonStatsData | undefined {
  return useLiveQuery(async () => {
    if (!personId) return undefined
    const rows = (await db.bridgeMeta.get('links'))?.value as LinkRow[] | undefined
    const peerId = buildLinkMap(rows ?? []).byLocal.get(personId)
    if (!peerId) return undefined
    return ((await db.bridgeMeta.get(META.stats))?.value as PeerStats | undefined)?.[peerId]
  }, [personId])
}
