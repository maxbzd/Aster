import type { SupabaseClient } from '@supabase/supabase-js'
import { BridgeError, type Connection, type FeedItem, type LinkRow, type Scope } from './protocol'
import { t } from '@/i18n'

/** Всё, что мост делает в СВОЁМ проекте Supabase (с входом в аккаунт этого приложения). */
export interface OwnBridge {
  listConnections(): Promise<Connection[]>
  listLinks(): Promise<LinkRow[]>
  publish(items: FeedItem[]): Promise<void>
  putLinks(rows: LinkRow[]): Promise<void>
  createOffer(label: string, scopes: Scope[]): Promise<{ code: string; expiresAt: string }>
  register(hash: string, scopes: Scope[]): Promise<string>
  complete(id: string, c: { label: string; url: string; key: string; token: string }): Promise<void>
  disconnect(id: string): Promise<void>
  setScopes(id: string, scopes: Scope[]): Promise<void>
}

const fail = (e: { message: string; code?: string }): never => {
  if (/too many connections/i.test(e.message)) throw new BridgeError('limit', t("Too many connections. Disconnect the ones you don't need."))
  if (/failed to fetch|network|load failed/i.test(e.message)) throw new BridgeError('offline', t('No internet connection'))
  if (e.code === '28000' || /not authenticated/i.test(e.message)) throw new BridgeError('not-signed-in', t("Sign in to this app's cloud first"))
  throw new BridgeError('server', e.message)
}

export function supabaseOwn(client: SupabaseClient): OwnBridge {
  return {
    async listConnections() {
      const { data, error } = await client.from('bridge_connections').select('id,peer_label,scopes,peer_url,peer_key,outbound_token,created_at,last_read_at')
      if (error) fail(error)
      return (data ?? []) as Connection[]
    },
    async listLinks() {
      const { data, error } = await client.from('bridge_links').select('local_id,peer_id,origin,deleted,updated_ms')
      if (error) fail(error)
      return (data ?? []).map(r => ({ ...r, updated_ms: Number(r.updated_ms) })) as LinkRow[]
    },
    async publish(items) {
      const { error } = await client.rpc('bridge_publish', { p_items: items.map(i => ({ entity: i.entity, key: i.key, data: i.data, deleted: i.deleted, updated_ms: i.updated_ms ?? Date.now() })) })
      if (error) fail(error)
    },
    async putLinks(rows) {
      const { error } = await client.rpc('bridge_links_put', { p_items: rows })
      if (error) fail(error)
    },
    async createOffer(label, scopes) {
      const { data, error } = await client.rpc('bridge_create_offer', { p_label: label, p_scopes: scopes })
      if (error) fail(error)
      const r = data as { code: string; expires_at: string }
      return { code: r.code, expiresAt: r.expires_at }
    },
    async register(hash, scopes) {
      const { data, error } = await client.rpc('bridge_register', { p_hash: hash, p_scopes: scopes })
      if (error) fail(error)
      return data as string
    },
    async complete(id, c) {
      const { error } = await client.rpc('bridge_complete', { p_id: id, p_label: c.label, p_url: c.url, p_key: c.key, p_token: c.token })
      if (error) fail(error)
    },
    async disconnect(id) {
      const { error } = await client.rpc('bridge_disconnect', { p_id: id })
      if (error) fail(error)
    },
    async setScopes(id, scopes) {
      const { error } = await client.rpc('bridge_set_scopes', { p_id: id, p_scopes: scopes })
      if (error) fail(error)
    },
  }
}
