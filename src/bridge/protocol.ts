import { t } from '@/i18n'
/**
 * The protocol of the bridge between apps (Aster ↔ Orbita), version 1. Described in docs/BRIDGE.md.
 *
 * IMPORTANT: the `src/bridge/` directory without `adapter*`, `service*` and the screen is shared code. It lives in both repositories
 * in the same form and depends on neither Dexie nor React: when you change it, update the copy in the other app.
 */

export const BRIDGE_VERSION = 1

export const SCOPES = ['people', 'commitments', 'captures', 'facts'] as const
export type Scope = (typeof SCOPES)[number]

export const ENTITIES = ['person', 'person_stats', 'commitment', 'commitment_state', 'capture', 'fact'] as const
export type Entity = (typeof ENTITIES)[number]

/** Which permission a kind of data belongs to (the same mapping is in the SQL bridge_scope_of). */
export const SCOPE_OF: Record<Entity, Scope> = {
  person: 'people',
  person_stats: 'people',
  commitment: 'commitments',
  commitment_state: 'commitments',
  capture: 'captures',
  fact: 'facts',
}

export const SCOPE_LABEL: Record<Scope, string> = {
  get people() { return t('People and connections') },
  get commitments() { return t('Commitments and reminders') },
  get captures() { return t('Meeting records') },
  get facts() { return t('Facts about people') },
}

/** A feed record: what an app publishes for the other one. */
export interface FeedItem {
  entity: Entity
  key: string
  data: Record<string, unknown> | null
  deleted: boolean
  /** the modification time, ms. If not set, the moment of publishing is used. */
  updated_ms?: number
}

export interface PulledItem {
  entity: Entity
  key: string
  data: Record<string, unknown> | null
  deleted: boolean
  updated_ms: number
  seq: number
}

export interface Connection {
  id: string
  peer_label: string
  scopes: Scope[]
  peer_url: string | null
  peer_key: string | null
  outbound_token: string | null
  created_at: string
  last_read_at: string | null
}

/** A link "my person = the other app's person". Rows with deleted mean "explicitly broken". */
export interface LinkRow {
  local_id: string
  peer_id: string
  origin: 'auto' | 'user'
  deleted: boolean
  updated_ms: number
}

/* ---------- the content of records (data) ---------- */

export interface PersonData {
  name: string
  aliases: string[]
  archived?: boolean
  /**
   * What I think about the link: the person's id in the receiving app. `null` means the link was explicitly broken,
   * and a missing field means "no opinion of my own".
   */
  peerRef?: string | null
}

export interface PersonStatsData {
  /** Aster */
  lastContactAt?: number
  closeness?: number
  interactions?: number
  /** Orbita */
  mentions?: number
  lastMentionAt?: number
  openIOwe?: number
  openOwedToMe?: number
}

export type CommitmentStatus = 'open' | 'done' | 'dropped'
export interface CommitmentData {
  title: string
  direction: 'i_owe' | 'owed_to_me'
  /** the person's id in the source app (Orbita) */
  personRef?: string
  personName?: string
  dueMs?: number
  createdMs?: number
  status: CommitmentStatus
  doneMs?: number
}

export interface CommitmentStateData {
  status: 'open' | 'done'
  doneMs?: number
}

export interface PersonRef { ref: string; name: string }

export interface CaptureData {
  day: string
  title?: string
  summary?: string
  place?: string
  /** meeting | call | message | note: how the source app understands the record */
  kind: 'meeting' | 'call' | 'message' | 'note'
  people: PersonRef[]
}

export interface FactData {
  title: string
  body?: string
  people: PersonRef[]
}

/* ---------- errors ---------- */

export type BridgeErrorKind =
  | 'bad-code' // the code is not recognised
  | 'code-expired' // the code is wrong or has expired
  | 'revoked' // the other side disconnected
  | 'offline'
  | 'not-signed-in' // not signed in to this app's cloud
  | 'limit' // too many connections
  | 'server'

export class BridgeError extends Error {
  constructor(public kind: BridgeErrorKind, message: string) {
    super(message)
    this.name = 'BridgeError'
  }
}

/** A message a person can understand. */
export function describeBridgeError(e: unknown): string {
  if (e instanceof BridgeError) return e.message
  const m = e instanceof Error ? e.message : String(e ?? '')
  if (/failed to fetch|network|load failed/i.test(m)) return t('No internet connection')
  return m || t('Something went wrong')
}

/** Keys in alphabetical order: the same content gives the same string. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** A record key for caches and fingerprint maps. */
export const itemKey = (entity: Entity, key: string) => `${entity}:${key}`
