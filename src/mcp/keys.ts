import { getClient } from '@/cloud/auth'
import { SUPABASE_URL } from '@/cloud/config'
import { t } from '@/i18n'

/* Ключи доступа для Claude (MCP). В базе хранится только хэш ключа: сам ключ виден один раз, при создании. */

export interface McpKey { id: string; label: string; created_at: string; last_used_at: string | null }

/** Адрес для подключения в Claude: ключ — часть адреса. */
export const mcpUrl = (token: string) => `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/mcp/${token}`

function explain(e: { message: string; code?: string }): never {
  if (/too many active keys/i.test(e.message)) throw new Error(t("Already five keys. Revoke the ones you don't need and create a new one."))
  if (e.code === '28000' || /not authenticated/i.test(e.message)) throw new Error(t('Sign in to the cloud first'))
  if (/failed to fetch|network|load failed/i.test(e.message)) throw new Error(t('No internet connection'))
  throw new Error(e.message)
}

export async function listKeys(): Promise<McpKey[]> {
  const { data, error } = await (await getClient()).rpc('mcp_list_tokens')
  if (error) explain(error)
  return (data ?? []) as McpKey[]
}

export async function createKey(label: string): Promise<{ id: string; token: string; url: string }> {
  const { data, error } = await (await getClient()).rpc('mcp_create_token', { p_label: label })
  if (error) explain(error)
  const r = data as { id: string; token: string }
  return { id: r.id, token: r.token, url: mcpUrl(r.token) }
}

export async function revokeKey(id: string): Promise<void> {
  const { error } = await (await getClient()).rpc('mcp_revoke_token', { p_id: id })
  if (error) explain(error)
}
