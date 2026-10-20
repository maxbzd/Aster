import { t } from '@/i18n'
/**
 * Протокол моста между приложениями (Aster ↔ Орбита), версия 1. Описание — docs/BRIDGE.md.
 *
 * ВАЖНО: каталог `src/bridge/` без `adapter*`, `service*` и экрана — общий код. Он лежит в обоих репозиториях
 * в одинаковом виде и не зависит ни от Dexie, ни от React: меняя его, обнови копию в другом приложении.
 */

export const BRIDGE_VERSION = 1

export const SCOPES = ['people', 'commitments', 'captures', 'facts'] as const
export type Scope = (typeof SCOPES)[number]

export const ENTITIES = ['person', 'person_stats', 'commitment', 'commitment_state', 'capture', 'fact'] as const
export type Entity = (typeof ENTITIES)[number]

/** Какому разрешению принадлежит вид данных (то же соответствие — в SQL bridge_scope_of). */
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

/** Запись витрины: то, что приложение публикует для другого. */
export interface FeedItem {
  entity: Entity
  key: string
  data: Record<string, unknown> | null
  deleted: boolean
  /** время изменения, мс. Если не задано, подставляется момент публикации. */
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

/** Связь «человек у меня = человек у другого приложения». Строки с deleted — «явно разорвано». */
export interface LinkRow {
  local_id: string
  peer_id: string
  origin: 'auto' | 'user'
  deleted: boolean
  updated_ms: number
}

/* ---------- содержимое записей (data) ---------- */

export interface PersonData {
  name: string
  aliases: string[]
  archived?: boolean
  /**
   * Что я думаю о связи: id человека в приложении-получателе. `null` — связь явно разорвана,
   * отсутствие поля — «своего мнения нет».
   */
  peerRef?: string | null
}

export interface PersonStatsData {
  /** Aster */
  lastContactAt?: number
  closeness?: number
  interactions?: number
  /** Орбита */
  mentions?: number
  lastMentionAt?: number
  openIOwe?: number
  openOwedToMe?: number
}

export type CommitmentStatus = 'open' | 'done' | 'dropped'
export interface CommitmentData {
  title: string
  direction: 'i_owe' | 'owed_to_me'
  /** id человека в приложении-источнике (Орбите) */
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
  /** meeting | call | message | note — как приложение-источник понимает запись */
  kind: 'meeting' | 'call' | 'message' | 'note'
  people: PersonRef[]
}

export interface FactData {
  title: string
  body?: string
  people: PersonRef[]
}

/* ---------- ошибки ---------- */

export type BridgeErrorKind =
  | 'bad-code' // код не распознан
  | 'code-expired' // код неверный или просрочен
  | 'revoked' // другая сторона отключила подключение
  | 'offline'
  | 'not-signed-in' // нет входа в облако этого приложения
  | 'limit' // слишком много подключений
  | 'server'

export class BridgeError extends Error {
  constructor(public kind: BridgeErrorKind, message: string) {
    super(message)
    this.name = 'BridgeError'
  }
}

/** Понятное сообщение для человека. */
export function describeBridgeError(e: unknown): string {
  if (e instanceof BridgeError) return e.message
  const m = e instanceof Error ? e.message : String(e ?? '')
  if (/failed to fetch|network|load failed/i.test(m)) return t('No internet connection')
  return m || t('Something went wrong')
}

/** Ключи в алфавитном порядке: одинаковое содержимое даёт одинаковую строку. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** Ключ записи для кэшей и карт отпечатков. */
export const itemKey = (entity: Entity, key: string) => `${entity}:${key}`
