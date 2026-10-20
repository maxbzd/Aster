import { authedFetch } from '@/ai/managed'
import { SUPABASE_URL } from '@/cloud/config'
import { t } from '@/i18n'

/* Calls to the server function `ticktick` (supabase/functions/ticktick). The TickTick keys and token live on the server. */

const base = () => `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ticktick`

export interface TickStatus { configured: boolean; connected: boolean; expiresAt: string | null }

export interface SyncItem { key: string; title: string; notes?: string; dueAt?: string; dueDay?: string; priority?: 'low' | 'normal' | 'high' }
export interface SyncBody { open: SyncItem[]; done: string[]; tz: string }
export interface SyncReply { completed: string[]; created: number; closed: number; errors: string[] }

export type SyncResult = { ok: true; reply: SyncReply } | { ok: false; reason: 'not_connected' | 'expired' | 'error'; message?: string }

export async function getStatus(): Promise<TickStatus | null> {
  try {
    const res = await authedFetch(`${base()}/status`, { cache: 'no-store' })
    if (!res.ok) return null
    const j = (await res.json()) as Partial<TickStatus>
    return { configured: !!j.configured, connected: !!j.connected, expiresAt: j.expiresAt ?? null }
  } catch { return null }
}

/** The address to send the person to so that they allow access in TickTick. */
export async function connectUrl(returnTo: string): Promise<string> {
  const res = await authedFetch(`${base()}/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnTo }) })
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok || !j.url) throw new Error(j.error ?? t("Couldn't start the connection"))
  return j.url
}

export async function disconnect(): Promise<void> {
  await authedFetch(`${base()}/disconnect`, { method: 'POST' })
}

export async function sync(body: SyncBody): Promise<SyncResult> {
  try {
    const res = await authedFetch(`${base()}/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = (await res.json().catch(() => ({}))) as Partial<SyncReply> & { error?: string }
    if (res.status === 409) return { ok: false, reason: j.error === 'expired' ? 'expired' : 'not_connected' }
    if (!res.ok) return { ok: false, reason: 'error', message: j.error }
    return { ok: true, reply: { completed: j.completed ?? [], created: j.created ?? 0, closed: j.closed ?? 0, errors: j.errors ?? [] } }
  } catch (e) {
    return { ok: false, reason: 'error', message: (e as Error).message }
  }
}
