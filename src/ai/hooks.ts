import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '@/data/db'
import { useAllInteractions, useAllPeople, useLeads, useNow, usePeople, useReminders } from '@/data/hooks'
import { activeAi } from './client'
import { modelInfo } from './models'
import { localMatches, type MatchPair } from './local/matches'
import type { Intro, Person } from '@/data/types'
import { reserveMatches } from './local/reserve'
import { occasionsFrom } from './astra'

/** Статус Астры: подключена ли облачная модель. */
export function useAstraStatus() {
  const s = useLiveQuery(async () => {
    const ai = await activeAi()
    return { connected: !!ai, model: ai ? modelInfo(ai.model) : null, webSearch: !!ai?.webSearch }
  }, [])
  return s ?? { connected: false, model: null, webSearch: false }
}

export function useIntros() {
  return useLiveQuery(() => db.intros.toArray(), []) ?? []
}

/** Результат последнего подсчёта: несколько экранов спрашивают одно и то же, считать надо один раз. */
let matchCache: { key: string; value: MatchPair[] } = { key: '', value: [] }
const NO_MATCHES: MatchPair[] = []

function matchKey(people: Person[], intros: Intro[]) {
  let h = people.length
  for (const p of people) h = (Math.imul(h, 31) + p.updatedAt + (p.archived ? 1 : 0)) | 0
  return `${h}:${intros.map(i => `${i.id}${i.status}`).join(',')}`
}

/**
 * Локальные пары для знакомства. Пересчёт идёт при изменении данных, а не при каждом заходе на экран;
 * в больших сетях — в простое браузера, чтобы не тормозить переход.
 */
export function useLocalMatches() {
  const people = usePeople()
  const intros = useIntros()
  const key = useMemo(() => (people ? matchKey(people, intros) : ''), [people, intros])
  const [, bump] = useState(0)
  const compute = (list: Person[]) => {
    const excluded = new Set(intros.filter(i => i.status !== 'suggested').map(i => `${i.aId}:${i.bId}`))
    matchCache = { key, value: localMatches(list, excluded) }
  }
  // небольшая сеть считается сразу, при отрисовке: это доли миллисекунды и без мигания
  if (people && people.length <= 120 && matchCache.key !== key) compute(people)

  useEffect(() => {
    if (!people || matchCache.key === key) return
    const run = () => { compute(people); bump(n => n + 1) }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
    if (w.requestIdleCallback) { const h = w.requestIdleCallback(run, { timeout: 1500 }); return () => w.cancelIdleCallback?.(h) }
    const timer = setTimeout(run, 60)
    return () => clearTimeout(timer)
  }, [people, intros, key]) // eslint-disable-line react-hooks/exhaustive-deps

  return matchCache.key === key ? matchCache.value : NO_MATCHES
}

/** Поводы написать — пересчитываются вживую. */
export function useOccasions() {
  const people = useAllPeople()
  const ints = useAllInteractions()
  const rems = useReminders()
  const matches = useLocalMatches()
  const now = useNow()
  return useMemo(() => occasionsFrom(people ?? [], ints, rems, matches, now), [people, ints, rems, matches, now])
}

/** Кто в сети что-то ищет — и у кого в резерве это уже есть. */
export function useReserveMatches() {
  const people = usePeople()
  const leads = useLeads()
  return useMemo(() => reserveMatches(people ?? [], leads ?? []), [people, leads])
}

export function useAiSpend() {
  return useLiveQuery(async () => {
    const all = await db.aiUsage.toArray()
    const month = Date.now() - 30 * 86400000
    const recent = all.filter(u => u.at > month)
    return { calls: recent.length, cost: recent.reduce((s, u) => s + u.cost, 0), tokens: recent.reduce((s, u) => s + u.input + u.output + u.cacheRead + u.cacheWrite, 0) }
  }, []) ?? { calls: 0, cost: 0, tokens: 0 }
}
