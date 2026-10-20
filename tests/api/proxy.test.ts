// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { corsHeaders, safeEqual } from '../../api/claude/[...path]'

const URL_BASE = 'https://aster.app/api/claude'
const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`${URL_BASE}${path}`, { method: 'POST', body: '{"x":1}', ...init, headers: { 'x-api-key': 'token-123', 'content-type': 'application/json', ...init.headers } })

const upstreamOk = () => new Response('{"id":"msg_1"}', { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } })

beforeEach(() => {
  vi.stubEnv('ASTER_TOKEN', 'token-123')
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-real')
  vi.stubEnv('ALLOWED_ORIGIN', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('safeEqual', () => {
  it('equal and different strings, different length, unicode', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
    expect(safeEqual('токен', 'токен')).toBe(true)
    expect(safeEqual('токен', 'токeн')).toBe(false)
  })
})

describe('CORS', () => {
  it('without ALLOWED_ORIGIN: from anywhere', () => {
    expect(corsHeaders(new Request('https://x', { headers: { origin: 'https://evil.com' } }), '')['access-control-allow-origin']).toBe('*')
  })
  it('with a list: only your own addresses, others get no header', () => {
    const allowed = 'https://aster.app, https://aster-dev.app'
    expect(corsHeaders(new Request('https://x', { headers: { origin: 'https://aster-dev.app' } }), allowed)['access-control-allow-origin']).toBe('https://aster-dev.app')
    expect(corsHeaders(new Request('https://x', { headers: { origin: 'https://evil.com' } }), allowed)['access-control-allow-origin']).toBeUndefined()
    expect(corsHeaders(new Request('https://x'), allowed)['access-control-allow-origin']).toBeUndefined()
  })
  it('the OPTIONS preflight answers 204 and allows the needed headers', async () => {
    const res = await handler(new Request(`${URL_BASE}/v1/messages`, { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toContain('anthropic-beta')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })
})

describe('access', () => {
  it('not POST → 405', async () => {
    const res = await handler(new Request(`${URL_BASE}/v1/messages`, { method: 'GET' }))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toContain('POST')
  })
  it('no token or a foreign token → 401 in Anthropic\'s error format', async () => {
    for (const key of ['', 'wrong-token', 'token-12', 'token-1234']) {
      const res = await handler(req('/v1/messages', { headers: { 'x-api-key': key } }))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ type: 'error', error: { type: 'authentication_error', message: 'Invalid token' } })
    }
  })
  it('the server is not configured → 500 with a hint, not a pass without a check', async () => {
    vi.stubEnv('ASTER_TOKEN', '')
    const res = await handler(req('/v1/messages'))
    expect(res.status).toBe(500)
    expect((await res.json()).error.message).toMatch(/ASTER_TOKEN/)
    vi.stubEnv('ASTER_TOKEN', 'token-123')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect((await handler(req('/v1/messages'))).status).toBe(500)
  })
  it('an empty token on the server does not match an empty client token', async () => {
    vi.stubEnv('ASTER_TOKEN', '')
    expect((await handler(req('/v1/messages', { headers: { 'x-api-key': '' } }))).status).toBe(500)
  })
  it.each(['/v1/files', '/v1/messages/batches', '/v1/organizations', '/', '/v1/messages/../files'])('other paths are closed: %s', async path => {
    const spy = vi.spyOn(globalThis, 'fetch')
    expect((await handler(req(path))).status).toBe(404)
    expect(spy).not.toHaveBeenCalled()
  })
  it('a too large body → 413 without calling Anthropic', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    const res = await handler(req('/v1/messages', { headers: { 'content-length': '5000000' } }))
    expect(res.status).toBe(413)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('proxying', () => {
  it('substitutes the server key, does not let the app token out, keeps the request and versions', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstreamOk())
    const res = await handler(req('/v1/messages?beta=true', { headers: { 'anthropic-version': '2024-01-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'msg_1' })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.anthropic.com/v1/messages?beta=true')
    expect(init.method).toBe('POST')
    expect(init.headers['x-api-key']).toBe('sk-real')
    expect(JSON.stringify(init.headers)).not.toContain('token-123')
    expect(init.headers['anthropic-version']).toBe('2024-01-01')
    expect(init.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01')
  })
  it('the default API version, count_tokens is allowed, a trailing slash does not matter', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstreamOk())
    await handler(req('/v1/messages/count_tokens/'))
    const [url, init] = spy.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://api.anthropic.com/v1/messages/count_tokens')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
  })
  it('the answer is not cached, the status and useful headers are kept', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":1}', { status: 429, headers: { 'retry-after': '30', 'content-type': 'application/json' } }))
    const res = await handler(req('/v1/messages'))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
  it('a streamed answer is passed through as is', async () => {
    const stream = new Response('data: 1\n\ndata: 2\n\n', { headers: { 'content-type': 'text/event-stream' } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(stream)
    const res = await handler(req('/v1/messages'))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(await res.text()).toBe('data: 1\n\ndata: 2\n\n')
  })
  it('Anthropic unavailable → 502 in the error format, without leaking details', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET sk-real'))
    const res = await handler(req('/v1/messages'))
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toContain('sk-real')
  })
  it('the server key never gets into the answer to the client', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstreamOk())
    const res = await handler(req('/v1/messages'))
    expect(JSON.stringify([...res.headers.entries()])).not.toContain('sk-real')
  })
})
