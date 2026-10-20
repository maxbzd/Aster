import { t } from '@/i18n'
/** A person in a simplified form: enough to look for matches between apps. */
export interface Named { id: string; name: string; aliases?: string[]; archived?: boolean }

export interface MatchLink { localId: string; peerId: string }
export interface Candidate { localId: string; peerId: string; score: number; reason: string }

const norm = (s: string) =>
  s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

const tokens = (s: string) => norm(s).split(' ').filter(Boolean)

/** "Alina Vorontsova" and "Vorontsova Alina" are the same. */
const fullKey = (s: string) => tokens(s).sort().join(' ')

/** A person's full names: the main one and all aliases that have at least two words. */
function fullKeys(p: Named): string[] {
  const out = new Set<string>()
  for (const n of [p.name, ...(p.aliases ?? [])]) if (tokens(n).length >= 2) out.add(fullKey(n))
  return [...out]
}

const firstToken = (p: Named) => tokens(p.name)[0] ?? ''
const hasSurname = (p: Named) => tokens(p.name).length >= 2

const pairKey = (localId: string, peerId: string) => `${localId}\u0000${peerId}`

/**
 * Finds the same people in two apps.
 *  - auto: the full name matched, and there is exactly one such person on each side. It is safe to link on its own.
 *  - candidates: similar but not certain ("Alina" and "Alina Vorontsova"). The person decides.
 * Already linked and explicitly broken pairs (blocked) are not here.
 */
export function matchPeople(mine: Named[], theirs: Named[], linked: MatchLink[], blocked: MatchLink[] = [], opts: { candidates?: boolean } = {}): { auto: MatchLink[]; candidates: Candidate[] } {
  const linkedLocal = new Set(linked.map(l => l.localId))
  const linkedPeer = new Set(linked.map(l => l.peerId))
  const blockedPairs = new Set(blocked.map(b => pairKey(b.localId, b.peerId)))
  const freeMine = mine.filter(p => !linkedLocal.has(p.id) && !p.archived)
  const freeTheirs = theirs.filter(p => !linkedPeer.has(p.id) && !p.archived)

  const byKeyMine = new Map<string, Named[]>()
  const byKeyTheirs = new Map<string, Named[]>()
  const put = (m: Map<string, Named[]>, k: string, p: Named) => m.set(k, [...(m.get(k) ?? []), p])
  for (const p of mine.filter(x => !x.archived)) for (const k of fullKeys(p)) put(byKeyMine, k, p)
  for (const p of theirs.filter(x => !x.archived)) for (const k of fullKeys(p)) put(byKeyTheirs, k, p)

  const auto: MatchLink[] = []
  const takenLocal = new Set<string>()
  const takenPeer = new Set<string>()
  for (const [k, ms] of byKeyMine) {
    const ts = byKeyTheirs.get(k)
    // a match is unambiguous only if there is one such name on each side (among already linked ones too)
    if (!ts || ms.length !== 1 || ts.length !== 1) continue
    const m = ms[0]!
    const value = ts[0]!
    if (linkedLocal.has(m.id) || linkedPeer.has(value.id) || blockedPairs.has(pairKey(m.id, value.id))) continue
    if (takenLocal.has(m.id) || takenPeer.has(value.id)) continue
    takenLocal.add(m.id)
    takenPeer.add(value.id)
    auto.push({ localId: m.id, peerId: value.id })
  }

  const candidates: Candidate[] = []
  if (opts.candidates === false) return { auto, candidates }
  for (const m of freeMine) {
    if (takenLocal.has(m.id)) continue
    const scored: Candidate[] = []
    for (const item of freeTheirs) {
      if (takenPeer.has(item.id) || blockedPairs.has(pairKey(m.id, item.id))) continue
      const c = score(m, item)
      if (c) scored.push({ localId: m.id, peerId: item.id, ...c })
    }
    scored.sort((a, b) => b.score - a.score)
    candidates.push(...scored.slice(0, 3))
  }
  candidates.sort((a, b) => b.score - a.score)
  return { auto, candidates }
}

function score(a: Named, b: Named): { score: number; reason: string } | null {
  const fa = fullKeys(a)
  const fb = fullKeys(b)
  if (fa.some(k => fb.includes(k))) return { score: 90, reason: t('The name matches, but there are others with the same name') }
  const first = firstToken(a)
  if (!first || first !== firstToken(b)) {
    // one side's name may be the other's alias ("Sasha")
    const names = (p: Named) => [p.name, ...(p.aliases ?? [])].map(norm)
    if (names(a).some(n => n && names(b).includes(n))) return { score: 70, reason: t('Alias matched') }
    return null
  }
  if (!hasSurname(a) || !hasSurname(b)) return { score: 60, reason: t('First name matched (one has no last name)') }
  const la = tokens(a.name).slice(1).join(' ')
  const lb = tokens(b.name).slice(1).join(' ')
  if (la === lb) return { score: 90, reason: t('First and last name matched') }
  // similar last names: Ivanov / Ivanova
  if (la.length >= 4 && lb.length >= 4 && (la.startsWith(lb.slice(0, -1)) || lb.startsWith(la.slice(0, -1)))) return { score: 55, reason: t('Similar last name') }
  return null
}

export const normName = norm
