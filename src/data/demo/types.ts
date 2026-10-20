import type { Closeness, Fact, InteractionType, Interaction, Person, Reminder } from '../types'

export interface Seed {
  f: string; l: string; role: string; co: string; city: string
  c: Closeness; circles: string[]; tags: string[]
  /** days since the last contact */
  last: number
  /** in how many days the birthday is, or a string */
  bday?: number | string
  age?: number
  /** how many days ago they met */
  met?: number
  place?: string
  story?: string
  tg?: string; phone?: string; email?: string; ig?: string; li?: string
  facts?: Fact[]
  family?: string
  help?: string; ihelp?: string
  topics?: string[]
  gifts?: string
  notes?: string
  nick?: string
  seek?: string
  pinned?: boolean
  cadence?: number
}

export interface LeadSeed {
  f: string; l: string; role: string; co?: string; city: string; why: string; src: string; tags: string[]; d: number
  tg?: string; ph?: string; em?: string; li?: string; star?: boolean
}

type ByName = (firstName: string) => Person

/**
 * A complete fictional dataset in one language. The demo is built from the pack that matches the interface language,
 * so every name, title and note reads naturally. Circle names in `Seed.circles` must be the default circle names of that language.
 */
export interface DemoPack {
  seeds: Seed[]
  titles: Record<InteractionType, string[]>
  notes: Partial<Record<InteractionType, string[]>>
  leads: LeadSeed[]
  /** the Web Summit-like source whose leads share one import batch */
  batchSource: string
  /** links between people: who introduced whom, friends, colleagues */
  relate: (byName: ByName) => void
  /** extra hand-made interactions (a group event and a note) */
  extraInteractions: (byName: ByName, today: number, uid: () => string) => Interaction[]
  reminders: (byName: ByName, today: number, now: number, uid: () => string) => Reminder[]
}
