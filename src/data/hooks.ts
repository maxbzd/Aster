import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from './db'
import type { Circle, Collection, ID, Interaction, Intro, Lead, Person, Reminder, Settings } from './types'

const EMPTY: never[] = []

/** Люди сети. Члены семьи — отдельные карточки, но в списках сети их нет: они живут внутри семьи человека. */
export function usePeople(includeArchived = false): Person[] | undefined {
  return useLiveQuery(async () => {
    const all = (await db.people.toArray()).filter(p => !p.familyOf)
    return includeArchived ? all : all.filter(p => !p.archived)
  }, [includeArchived])
}

/** Вообще все карточки, включая семью и архив: для дат, поиска и связей. */
export const useAllPeople = (): Person[] | undefined => useLiveQuery(() => db.people.toArray(), [])

export const useCollections = (): Collection[] => useLiveQuery(() => db.collections.orderBy('order').toArray(), []) ?? EMPTY

export const useIntros = (): Intro[] => useLiveQuery(() => db.intros.toArray(), []) ?? EMPTY

export const useLeads = (): Lead[] | undefined => useLiveQuery(() => db.leads.toArray(), [])

export const useLead = (id?: ID) => useLiveQuery(async () => (id ? (await db.leads.get(id)) ?? null : null), [id])

/** Счётчики для переключателя «Сеть / Резерв». */
export function useCounts() {
  return useLiveQuery(async () => {
    const [people, leads] = await Promise.all([db.people.filter(p => !p.archived && !p.familyOf).count(), db.leads.count()])
    return { people, leads }
  }, []) ?? { people: 0, leads: 0 }
}

/** undefined — ещё грузится, null — такого человека нет. */
export const usePerson = (id?: ID) =>
  useLiveQuery(async () => (id ? (await db.people.get(id)) ?? null : null), [id])

export const useCircles = (): Circle[] =>
  useLiveQuery(() => db.circles.orderBy('order').toArray(), []) ?? EMPTY

export const useSettings = (): Settings | null | undefined =>
  useLiveQuery(async () => (await db.settings.get('me')) ?? null, [])

export const useInteractionsFor = (personId?: ID): Interaction[] =>
  useLiveQuery(
    async () => (personId ? (await db.interactions.where('personIds').equals(personId).toArray()).sort((a, b) => b.date - a.date) : []),
    [personId],
  ) ?? EMPTY

export const useRecentInteractions = (limit = 8): Interaction[] =>
  useLiveQuery(() => db.interactions.orderBy('date').reverse().limit(limit).toArray(), [limit]) ?? EMPTY

export const useAllInteractions = (): Interaction[] =>
  useLiveQuery(() => db.interactions.toArray(), []) ?? EMPTY

export const useReminders = (): Reminder[] =>
  useLiveQuery(() => db.reminders.orderBy('dueAt').toArray(), []) ?? EMPTY

export const useRemindersFor = (personId?: ID): Reminder[] =>
  useLiveQuery(async () => (personId ? (await db.reminders.where('personId').equals(personId).sortBy('dueAt')) : []), [personId]) ?? EMPTY

/** Тикает раз в минуту, чтобы «сегодня/вчера» и приветствие оставались свежими. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const fn = () => setM(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [q])
  return m
}
