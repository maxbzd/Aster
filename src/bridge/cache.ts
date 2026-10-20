import { db } from '@/data/db'
import { fullName } from '@/lib/format'
import type { Person } from '@/data/types'
import type { MetaStore } from './cycle'
import type { Named } from './match'
import type { CaptureData, FactData, PersonData, PersonStatsData } from './protocol'

/** Кэши данных Орбиты на этом устройстве (хранятся в bridgeMeta). Лёгкий модуль: его читает главный экран. */
export const META = { people: 'peerPeople', stats: 'peerStats', captures: 'peerCaptures', facts: 'peerFacts' } as const

export type PeerPeople = Record<string, PersonData & { ms: number }>
export type PeerStats = Record<string, PersonStatsData>
export type PeerCaptures = Record<string, CaptureData & { ms: number }>
export type PeerFacts = Record<string, FactData & { ms: number }>

/** Служебное состояние моста в Dexie. */
export const bridgeMeta: MetaStore = {
  get: async <T>(key: string) => (await db.bridgeMeta.get(key))?.value as T | undefined,
  set: async (key, value) => { await db.bridgeMeta.put({ key, value }) },
}

export const toNamed = (people: Person[]): Named[] =>
  people.filter(p => !p.familyOf).map(p => ({ id: p.id, name: fullName(p), aliases: p.nickname ? [p.nickname] : [], archived: p.archived }))

export const peerToNamed = (peers: PeerPeople): Named[] =>
  Object.entries(peers).map(([id, p]) => ({ id, name: p.name, aliases: p.aliases, archived: p.archived }))
