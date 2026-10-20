export type ID = string

/** 1 inner circle, 2 close ones, 3 network, 4 acquaintances. It is also the number of the orbit. */
export type Closeness = 1 | 2 | 3 | 4

export type ChannelType =
  | 'phone' | 'telegram' | 'whatsapp' | 'email' | 'instagram' | 'linkedin' | 'x' | 'website' | 'other'

export interface Channel { type: ChannelType; value: string }

export type FactIcon =
  | 'sparkle' | 'cake' | 'globe' | 'heart' | 'briefcase' | 'book' | 'music'
  | 'food' | 'plane' | 'baby' | 'star' | 'coffee' | 'paw' | 'trophy'

export interface Fact { icon: FactIcon; text: string }

/** Who a person is to the one whose family this is. Gender-neutral on purpose. */
export type FamilyRelation = 'partner' | 'child' | 'parent' | 'sibling' | 'relative'

/** A significant date in a person's life (other than the birthday, which is stored in `birthday`). */
export type DateKind = 'anniversary' | 'nameday' | 'jubilee' | 'event' | 'custom'
export interface ImportantDate {
  id: ID
  kind: DateKind
  /** "Wedding anniversary", "Name day", "Moving to Lisbon" */
  label: string
  /** YYYY-MM-DD, or --MM-DD if the year is unknown */
  date: string
  /** repeats every year (yes by default); otherwise a one-off event */
  yearly?: boolean
  /** how many days ahead to remind (3 by default) */
  remindDays?: number
}

/** Informal or formal address ("ty" / "vy" are the Russian T-V forms; the values are kept for stored data). */
export type AddressForm = 'ty' | 'vy'
export type AlcoholPref = 'yes' | 'no' | 'rarely'
export type BestTime = 'morning' | 'day' | 'evening' | 'weekend'

/** How it is best to communicate with a person, and what they like. */
export interface Prefs {
  food?: string
  allergies?: string
  alcohol?: AlcoholPref
  hobbies?: string[]
  /** informal or formal address */
  address?: AddressForm
  bestChannel?: ChannelType
  bestTime?: BestTime
  /** the language to communicate in, as a code: ru, en, es… */
  language?: string
}

/** A life status that keeps the person without deleting them. Unset means the person is in the ordinary life of the network. */
export type LifeStatus = 'lost_touch' | 'paused' | 'irrelevant'

/** Who started the contact. */
export type Initiator = 'me' | 'them' | 'both'
export interface Topic { id: ID; text: string; done: boolean }
export interface PersonLink { personId: ID; label: string }

export interface Person {
  id: ID
  createdAt: number
  updatedAt: number

  firstName: string
  lastName?: string
  nickname?: string
  photo?: string // resized data URL

  company?: string
  role?: string
  city?: string

  circleIds: ID[]
  tags: string[] // interests and topics
  closeness: Closeness
  /** Rhythm of contact in days. undefined: the default for the orbit; 0: no rhythm. */
  cadenceDays?: number

  birthday?: string // YYYY-MM-DD, or --MM-DD if the year is unknown
  metAt?: string // YYYY-MM-DD
  metPlace?: string
  metStory?: string
  introducedBy?: ID

  channels: Channel[]
  facts: Fact[]
  family?: string
  canHelpMe?: string
  iCanHelp?: string
  /** What the person is looking for now: the fuel for the matchmaker and the reasons to write. */
  lookingFor?: string
  topics: Topic[]
  giftIdeas?: string
  notes?: string
  links: PersonLink[]

  pinned?: boolean
  archived?: boolean
  snoozedUntil?: number
  lastContactAt?: number

  /** A member of another person's family: stored as a separate person with their own birthday. */
  familyOf?: ID
  relation?: FamilyRelation
  importantDates?: ImportantDate[]
  prefs?: Prefs
  lifeStatus?: LifeStatus
  lifeStatusNote?: string
  lifeStatusAt?: number
  /** "Around every day": colleagues and close ones who need no rhythm and no reminders */
  everyday?: boolean
  /** when the person dismissed Astra's suggestion to change the rhythm (not shown again for 90 days) */
  cadenceHintDismissedAt?: number
}

export type InteractionType =
  | 'meeting' | 'call' | 'message' | 'event' | 'favor_given' | 'favor_got' | 'gift' | 'note'

export interface Interaction {
  id: ID
  personIds: ID[]
  type: InteractionType
  date: number
  title?: string
  note?: string
  place?: string
  createdAt: number
  /** who started the contact, for reciprocity */
  initiator?: Initiator
  /** where a record from another app (the Orbita bridge) came from: no duplicate is created for the same key */
  bridgeKey?: string
}

export interface Reminder {
  id: ID
  personId?: ID
  text: string
  dueAt: number
  done: boolean
  doneAt?: number
  createdAt: number
  /** when the reminder was last changed; the bridge uses it to decide whose edit is newer */
  updatedAt?: number
  /** the key of a commitment in Orbita: the reminder is its mirror */
  bridgeKey?: string
}

/* ---------- Reserve: useful contacts kept in store ---------- */

/** A person with whom there is no relationship yet: a strong contact "just in case". */
export interface Lead {
  id: ID
  createdAt: number
  updatedAt: number
  firstName: string
  lastName?: string
  company?: string
  role?: string
  city?: string
  /** why they are valuable: the main field, it is what you search by later */
  why?: string
  /** where the contact came from: "Web Summit", "founders chat", "from Alice" */
  source?: string
  tags: string[]
  channels: Channel[]
  notes?: string
  star?: boolean
  /** the shared id of an import batch, so the whole batch can be undone at once */
  batchId?: ID
}

export type PaletteKey = 'aurora' | 'ember' | 'rose' | 'jade' | 'ocean' | 'gold' | 'orchid' | 'ice'

export interface Circle {
  id: ID
  name: string
  emoji: string
  palette: PaletteKey
  order: number
}

/** A list that a person assembles themselves: "For the round", "For hiring", "For PR". */
export interface Collection {
  id: ID
  name: string
  emoji: string
  palette: PaletteKey
  /** what the list is for: one line for yourself */
  note?: string
  personIds: ID[]
  /** contacts from the reserve can be put in a list too */
  leadIds: ID[]
  order: number
  createdAt: number
  updatedAt: number
}

/** managed: the key is on the server (an Edge Function), sign in with an account; key: your own key on the device; proxy: your own proxy with a token */
export type AiMode = 'off' | 'key' | 'proxy' | 'managed'

export interface AiSettings {
  mode: AiMode
  apiKey?: string
  proxyUrl?: string
  proxyToken?: string
  model: string
  /** send notes and the interaction history as context */
  shareNotes: boolean
  /** look up news about people and companies on the web */
  webSearch: boolean
  consentAt?: number
}

export interface Settings {
  id: 'me'
  name: string
  photo?: string
  onboarded: boolean
  createdAt: number
  demo?: boolean
  ai?: AiSettings
  /** when a backup file was last saved */
  lastBackupAt?: number
  /** do not remind about a backup until this date */
  backupSnoozeUntil?: number
  /** which of Orbita's suggestions were already accepted or dismissed (synced between devices) */
  bridgeHandled?: string[]
  /** speech-to-text from a file: the key and address are stored on this device only */
  stt?: SttSettings
  /** voice control: on this device only */
  voice?: VoiceSettings
}

export type SttProvider = 'off' | 'openai' | 'managed'
export interface SttSettings {
  provider: SttProvider
  /** an OpenAI-compatible server: key and address */
  apiKey?: string
  baseUrl?: string
  model?: string
  /** the language of the recording, for example en */
  language?: string
}

export interface VoiceSettings {
  /** listen for the phrase "Astra, …" without pressing a button */
  wake: boolean
  /** read the confirmation question aloud */
  speak: boolean
}

/** A message in a conversation with Astra. Stored on the device only. */
export interface ChatMessage {
  id: ID
  at: number
  role: 'user' | 'astra'
  text: string
  /** the people the answer is about: cards under the message, each with its own reason */
  cards?: Array<{ id: ID; reason: string }>
  /** excerpts from the interaction records: what exactly was said and when */
  quotes?: ChatQuote[]
  followUps?: string[]
  /** who or what was discussed: needed to understand "and what did he promise?" */
  focus?: { personId?: ID; filters?: ChatFilters }
  /** where the answer came from: the local engine or a model */
  source?: 'local' | 'ai'
}

export interface ChatQuote { personId: ID; /** unix ms; 0 means no date */ date: number; text: string; kind?: 'mine' | 'theirs' | 'agreed' | 'topic' }

/** Conditions for selecting people from a question such as "which investors in Dubai haven't I seen for a while". */
export interface ChatFilters {
  circleIds?: ID[]
  collectionId?: ID
  city?: string
  /** word stems of the role, company, interests */
  terms?: string[]
  stale?: boolean
  /** "haven't seen": only real meetings count */
  meetingsOnly?: boolean
}

/* ---------- Astra ---------- */

export type IntroStatus = 'suggested' | 'asked' | 'done' | 'dismissed'
export interface Intro {
  id: ID
  aId: ID
  bId: ID
  reason: string
  status: IntroStatus
  createdAt: number
  updatedAt: number
}

export interface NetEvent {
  id: ID
  name: string
  place?: string
  startedAt: number
  endedAt?: number
  circleIds: ID[]
}

export interface Capture {
  id: ID
  eventId?: ID
  createdAt: number
  photo?: string // data URL, a resized photo of a badge or business card
  text?: string
  status: 'pending' | 'saved' | 'skipped'
}

export interface AiCacheEntry { key: string; at: number; value: unknown }

export interface AiUsage {
  id: ID
  at: number
  task: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}
