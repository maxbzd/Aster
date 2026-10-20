/**
 * Astra proxy for Vercel: the Anthropic key stays on the server (ANTHROPIC_API_KEY),
 * and the app only knows an access token (ASTER_TOKEN).
 *
 * In Astra's settings: mode "Server", address https://<your-domain>/api/claude, token = ASTER_TOKEN.
 * Optional: ALLOWED_ORIGIN is a comma-separated list of app origins (otherwise it is reachable from anywhere, but still needs the token).
 */
export const config = { runtime: 'edge' }

const UPSTREAM = 'https://api.anthropic.com'
/** The app needs only messages: everything else (files, batch processing, keys) is not exposed. */
const ALLOWED_PATHS = new Set(['/v1/messages', '/v1/messages/count_tokens'])
const MAX_BODY_BYTES = 2_000_000
const TIMEOUT_MS = 110_000

/** Constant-time comparison: the token cannot be guessed from response timing. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export function corsHeaders(req: Request, allowed = process.env.ALLOWED_ORIGIN): Record<string, string> {
  const base = {
    'access-control-allow-headers': 'content-type, x-api-key, anthropic-version, anthropic-beta',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
  }
  const list = (allowed ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!list.length) return { ...base, 'access-control-allow-origin': '*' }
  const origin = req.headers.get('origin') ?? ''
  return list.includes(origin) ? { ...base, 'access-control-allow-origin': origin, vary: 'origin' } : { ...base, vary: 'origin' }
}

const fail = (status: number, type: string, message: string, headers: Record<string, string>) =>
  new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' } })

export default async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return fail(405, 'invalid_request_error', 'Method not allowed', { ...cors, allow: 'POST, OPTIONS' })

  const { ASTER_TOKEN, ANTHROPIC_API_KEY } = process.env
  if (!ASTER_TOKEN || !ANTHROPIC_API_KEY) return fail(500, 'api_error', 'The proxy is not configured: set ASTER_TOKEN and ANTHROPIC_API_KEY', cors)
  if (!safeEqual(req.headers.get('x-api-key') ?? '', ASTER_TOKEN)) return fail(401, 'authentication_error', 'Invalid token', cors)

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api\/claude/, '').replace(/\/+$/, '')
  if (!ALLOWED_PATHS.has(path)) return fail(404, 'not_found_error', 'Not found', cors)

  const length = Number(req.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) return fail(413, 'request_too_large', 'Request too large', cors)

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': req.headers.get('anthropic-version') ?? '2023-06-01',
  }
  const beta = req.headers.get('anthropic-beta')
  if (beta) headers['anthropic-beta'] = beta

  let upstream: Response
  try {
    upstream = await fetch(`${UPSTREAM}${path}${url.search}`, { method: 'POST', headers, body: req.body, duplex: 'half', signal: AbortSignal.timeout(TIMEOUT_MS) } as RequestInit)
  } catch {
    return fail(502, 'api_error', 'Could not reach Anthropic', cors)
  }

  const out: Record<string, string> = { ...cors, 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' }
  for (const h of ['retry-after', 'request-id']) {
    const v = upstream.headers.get(h)
    if (v) out[h] = v
  }
  return new Response(upstream.body, { status: upstream.status, headers: out })
}
