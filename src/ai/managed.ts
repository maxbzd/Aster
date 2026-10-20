import { useEffect, useState } from 'react'
import { getClient, hasStoredSession } from '@/cloud/auth'
import { SUPABASE_URL } from '@/cloud/config'
import { useCloud } from '@/cloud/store'
import { gatewayModel, MODELS, SERVER_MODELS, type ModelInfo } from './models'

/**
 * Server mode: AI and speech-to-text keys live in the secrets of the Supabase Edge Function `ai` (supabase/functions/ai).
 * The app calls it with the session of its cloud account: the key never reaches the browser and there is nothing to type in.
 */

export interface ServerStatus { allowed: boolean; anthropic: boolean; gemini: boolean; groq: boolean; gateway: boolean; gatewayModels: string[]; stt: boolean }

export async function accessToken(): Promise<string | null> {
  if (!hasStoredSession()) return null
  try {
    const { data } = await (await getClient()).auth.getSession()
    return data.session?.access_token ?? null
  } catch { return null }
}

/** A fetch that signs the request with a fresh session; used by the SDK and the AI and speech clients. */
export async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = await accessToken()
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  headers.delete('x-api-key')
  if (token) headers.set('authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

/** Function address: https://<project>.supabase.co/functions/v1/ai */
export const serverBase = () => `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ai`

/** What is connected on the server. null — no function, or not signed in. */
export async function fetchServerStatus(): Promise<ServerStatus | null> {
  try {
    const res = await authedFetch(`${serverBase()}/status`, { cache: 'no-store' })
    if (!res.ok) return null
    const j = (await res.json()) as Partial<ServerStatus>
    return { allowed: !!j.allowed, anthropic: !!j.anthropic, gemini: !!j.gemini, groq: !!j.groq, gateway: !!j.gateway, gatewayModels: Array.isArray(j.gatewayModels) ? j.gatewayModels.filter((x): x is string => typeof x === 'string') : [], stt: !!j.stt }
  } catch { return null }
}

/** Whether the server has any AI key: free Gemini and Groq, your gateway, or paid Claude. */
export const serverHasAi = (s: ServerStatus | null) => !!s && s.allowed && (s.anthropic || s.gemini || s.groq || s.gateway)

/** Server status for the UI: checked after signing in. */
export function useServerStatus(): ServerStatus | null {
  const userId = useCloud(s => s.userId)
  const [status, setStatus] = useState<ServerStatus | null>(null)
  useEffect(() => {
    if (!userId) { setStatus(null); return }
    let alive = true
    void fetchServerStatus().then(s => { if (alive) setStatus(s) })
    return () => { alive = false }
  }, [userId])
  return status
}

/** Models offered in the server mode: your gateway first, then the free Gemini/Groq ones, then Claude when its key is set. */
export function serverModels(s: ServerStatus | null): ModelInfo[] {
  if (!s?.allowed) return []
  return [
    ...(s.gateway ? s.gatewayModels.map(gatewayModel) : []),
    ...SERVER_MODELS.filter(m => (m.provider === 'gemini' && s.gemini) || (m.provider === 'groq' && s.groq)),
    ...(s.anthropic ? MODELS : []),
  ]
}
