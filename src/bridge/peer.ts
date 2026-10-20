import { BridgeError, type PulledItem } from './protocol'
import { t } from '@/i18n'

/** Где живёт другое приложение: адрес проекта и публичный ключ. */
export interface PeerEndpoint { url: string; key: string }

type Fetch = typeof fetch

/**
 * Вызов функции в проекте другого приложения. Идёт без входа: доступ даёт ключ в параметрах (p_token),
 * который сервер сверяет с хэшем. Библиотека Supabase не нужна — обычный fetch.
 */
export async function peerRpc<T>(ep: PeerEndpoint, fn: string, body: Record<string, unknown>, fetchImpl: Fetch = fetch): Promise<T> {
  let res: Response
  try {
    res = await fetchImpl(`${ep.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ep.key },
      body: JSON.stringify(body),
    })
  } catch {
    throw new BridgeError('offline', t('No internet connection'))
  }
  if (res.ok) {
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }
  let err: { code?: string; message?: string } = {}
  try { err = (await res.json()) as typeof err } catch { /* тело не JSON */ }
  const code = err.code ?? ''
  const value = err.message ?? `HTTP ${res.status}`
  if (code === '28000' || /invalid (token|code)/i.test(value)) {
    throw new BridgeError(fn === 'bridge_accept' ? 'code-expired' : 'revoked', fn === 'bridge_accept' ? t('The code is wrong or has expired. Create a new one.') : t('The connection was disconnected from the other side.'))
  }
  if (/too many connections/i.test(value)) throw new BridgeError('limit', t("Too many connections. Disconnect the ones you don't need."))
  if (res.status >= 500 || res.status === 429) throw new BridgeError('offline', t("The other app's server is unavailable right now"))
  throw new BridgeError('server', value)
}

export interface PullResult { rows: PulledItem[]; next: number | null }

export const peerPull = (ep: PeerEndpoint, token: string, after: number, limit: number, f?: Fetch) =>
  peerRpc<PullResult>(ep, 'bridge_pull', { p_token: token, p_after: after, p_limit: limit }, f)

export interface AcceptResult { token: string; label: string; scopes: string[] }

export const peerAccept = (ep: PeerEndpoint, args: { code: string; label: string; url: string; key: string; token: string }, f?: Fetch) =>
  peerRpc<AcceptResult>(ep, 'bridge_accept', { p_code: args.code, p_label: args.label, p_peer_url: args.url, p_peer_key: args.key, p_peer_token: args.token }, f)

/** Сообщить другому приложению, что выданный им ключ больше не нужен. Ошибки игнорируются. */
export const peerDrop = (ep: PeerEndpoint, token: string, f?: Fetch) =>
  peerRpc<null>(ep, 'bridge_drop', { p_token: token }, f).catch(() => null)
