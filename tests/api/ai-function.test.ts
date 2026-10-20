// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowedEmails, checkAnthropicBody, checkCompatBody, corsFor, deepgramText, handle, isAllowed, keyterms, rateLimited, verifyToken, type Env } from '../../supabase/functions/ai/handler'

const SITE = 'https://aster.example.com'
const BASE = 'https://proj.supabase.co/functions/v1/ai'
const env = (over: Partial<Env> = {}): Env => ({
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_x',
  ANTHROPIC_API_KEY: 'sk-real', GEMINI_API_KEY: 'g-real', GROQ_API_KEY: 'q-real', GATEWAY_API_KEY: 'gw-real', GATEWAY_BASE_URL: 'https://gateway.example.com/v1', GATEWAY_MODELS: 'vendor/model-a,vendor/model-b', STT_API_KEY: 'stt-real',
  ALLOWED_EMAILS: 'Owner@Mail.com', ALLOWED_ORIGINS: SITE, ...over,
})

type U = { id: string; email: string; email_confirmed_at: string | null }
const owner: U = { id: 'u1', email: 'owner@mail.com', email_confirmed_at: '2026-01-01T00:00:00Z' }
let seq = 0
const token = () => `tok${++seq}.abc-def`

/** Supabase отвечает про пользователя, всё остальное — по заданному ответу. */
function mockFetch(user: U | null, upstream?: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (u.includes('/auth/v1/user')) return user ? new Response(JSON.stringify(user), { status: 200 }) : new Response('{}', { status: 401 })
    return upstream ? upstream() : new Response('{"id":"msg_1"}', { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } })
  }))
  return calls
}

const CLAUDE = '{"model":"claude-sonnet-5-5","max_tokens":100,"messages":[]}'
const GEMINI = '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"hi"}],"response_format":{"type":"json_object"}}'
const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}, e = env()) => {
  const body = 'body' in init ? init.body : CLAUDE
  const type: Record<string, string> = typeof body === 'string' ? { 'content-type': 'application/json' } : {}
  return handle(new Request(`${BASE}${path}`, { method: 'POST', ...init, body, headers: { authorization: `Bearer ${token()}`, origin: SITE, ...type, ...init.headers } }), e)
}
const get = (path: string, init: { headers?: Record<string, string> } = {}, e = env()) => call(path, { method: 'GET', body: undefined, ...init }, e)

afterEach(() => vi.unstubAllGlobals())

describe('доступ', () => {
  it('почты: регистр и разделители не важны, пустой список — закрыто для всех', () => {
    expect(allowedEmails({ ALLOWED_EMAILS: 'A@x.com, b@y.com;c@z.com' })).toEqual(['a@x.com', 'b@y.com', 'c@z.com'])
    expect(isAllowed({ id: '1', email: 'OWNER@mail.com', confirmed: true }, env())).toBe(true)
    expect(isAllowed({ id: '1', email: 'owner@mail.com', confirmed: false }, env())).toBe(false)
    expect(isAllowed({ id: '1', email: 'other@mail.com', confirmed: true }, env())).toBe(false)
    expect(isAllowed({ id: '1', email: 'owner@mail.com', confirmed: true }, env({ ALLOWED_EMAILS: '' }))).toBe(false)
    expect(isAllowed(null, env())).toBe(false)
  })

  it('без токена, с чужим и с подозрительным токеном — 401, до провайдеров дело не доходит', async () => {
    const calls = mockFetch(null)
    expect((await call('/anthropic/v1/messages', { headers: { authorization: '' } })).status).toBe(401)
    expect((await call('/anthropic/v1/messages')).status).toBe(401)
    expect((await call('/anthropic/v1/messages', { headers: { authorization: 'Bearer a b' } })).status).toBe(401)
    expect(calls.every(c => c.url.includes('/auth/v1/user'))).toBe(true)
  })

  it('вошёл, но почта не в списке или не подтверждена — 403, ключи не используются', async () => {
    let calls = mockFetch({ id: 'u2', email: 'stranger@mail.com', email_confirmed_at: '2026-01-01T00:00:00Z' })
    expect((await call('/anthropic/v1/messages')).status).toBe(403)
    expect((await call('/gemini/chat/completions', { body: GEMINI })).status).toBe(403)
    expect(calls.some(c => !c.url.includes('/auth/v1/user'))).toBe(false)
    calls = mockFetch({ ...owner, email_confirmed_at: null })
    expect((await call('/anthropic/v1/messages')).status).toBe(403)
  })

  it('токен проверяется у Supabase с публичным ключом проекта и запоминается на минуту', async () => {
    const calls = mockFetch(owner)
    const t = token()
    const e = env()
    expect((await verifyToken(t, e, 1000))?.email).toBe('owner@mail.com')
    await verifyToken(t, e, 2000)
    expect(calls).toHaveLength(1)
    expect((calls[0]!.init!.headers as Record<string, string>).apikey).toBe('sb_publishable_x')
    await verifyToken(t, e, 1000 + 61_000)
    expect(calls).toHaveLength(2)
  })
})

describe('CORS: только свои сайты', () => {
  it('чужой Origin — 403; свой — отвечает с разрешающими заголовками; preflight проходит без токена', async () => {
    mockFetch(owner)
    expect((await call('/anthropic/v1/messages', { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    const ok = await call('/anthropic/v1/messages')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBe(SITE)
    const pre = await handle(new Request(`${BASE}/anthropic/v1/messages`, { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST' } }), env())
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization')
    const sdk = await handle(new Request(`${BASE}/anthropic/v1/messages`, { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-headers': 'authorization,anthropic-version,x-stainless-os' } }), env())
    expect(sdk.headers.get('access-control-allow-headers')).toBe('authorization,anthropic-version,x-stainless-os')
    const bad = await handle(new Request(`${BASE}/status`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env())
    expect(bad.status).toBe(403)
  })

  it('без списка адресов браузерные запросы закрыты; без Origin (не браузер) проходят, но токен обязателен', () => {
    const r = (origin?: string) => new Request(BASE, { headers: origin ? { origin } : {} })
    expect(corsFor(r(SITE), env({ ALLOWED_ORIGINS: '' }))).toBeNull()
    expect(corsFor(r(), env({ ALLOWED_ORIGINS: '' }))).toEqual({})
    expect(corsFor(r(SITE), env({ ALLOWED_ORIGINS: `${SITE}/` }))?.['access-control-allow-origin']).toBe(SITE)
  })
})

describe('Claude', () => {
  it('запрос уходит к Anthropic с серверным ключом, а не с токеном пользователя', async () => {
    const calls = mockFetch(owner)
    const r = await call('/anthropic/v1/messages')
    expect(r.status).toBe(200)
    expect(r.headers.get('request-id')).toBe('req_1')
    expect(r.headers.get('cache-control')).toBe('no-store')
    const up = calls.find(c => c.url.includes('api.anthropic.com'))!
    expect(up.url).toBe('https://api.anthropic.com/v1/messages')
    const h = up.init!.headers as Record<string, string>
    expect(h['x-api-key']).toBe('sk-real')
    expect(JSON.stringify(h)).not.toContain('tok')
  })

  it('beta-параметр и заголовок пробрасываются; лишние пути и методы закрыты', async () => {
    const calls = mockFetch(owner)
    await call('/anthropic/v1/messages?beta=true', { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } })
    const up = calls.find(c => c.url.includes('api.anthropic.com'))!
    expect(up.url).toBe('https://api.anthropic.com/v1/messages?beta=true')
    expect((up.init!.headers as Record<string, string>)['anthropic-beta']).toBe('server-side-fallback-2026-07-01')
    expect((await call('/anthropic/v1/files')).status).toBe(404)
    expect((await call('/anthropic/v1/messages/batches')).status).toBe(404)
    expect((await get('/anthropic/v1/messages')).status).toBe(405)
  })

  it('тело: известные модели, умеренный ответ, свои инструменты и веб-поиск', () => {
    const ok = (o: object) => checkAnthropicBody(JSON.stringify(o)).ok
    expect(ok({ model: 'claude-opus-5-5', max_tokens: 12000, messages: [] })).toBe(true)
    expect(ok({ model: 'claude-haiku-4-5-20251001', messages: [] })).toBe(true)
    expect(ok({ model: 'gpt-5', messages: [] })).toBe(false)
    expect(ok({ model: 'claude-opus-5-5/../x', messages: [] })).toBe(false)
    expect(ok({ model: 'claude-opus-5-5', max_tokens: 999999, messages: [] })).toBe(false)
    expect(ok({ model: 'claude-opus-5-5', messages: [], tools: [{ type: 'web_search_20260209', name: 'web_search' }] })).toBe(true)
    expect(ok({ model: 'claude-opus-5-5', messages: [], tools: [{ name: 'emit', input_schema: { type: 'object' } }], tool_choice: { type: 'tool', name: 'emit' }, stream: true })).toBe(true)
    expect(ok({ model: 'claude-opus-5-5', messages: [], tools: [{ type: 'code_execution_20250522', name: 'x' }] })).toBe(false)
    expect(ok({ model: 'claude-opus-5-5', messages: [], mcp_servers: [] })).toBe(false)
    expect(checkAnthropicBody('не json').ok).toBe(false)
    expect(checkAnthropicBody('[]').ok).toBe(false)
  })

  it('нет ключа на сервере — 503; большой запрос — 413; ошибка Anthropic доходит без утечки ключа', async () => {
    mockFetch(owner)
    expect((await call('/anthropic/v1/messages', {}, env({ ANTHROPIC_API_KEY: undefined }))).status).toBe(503)
    const big = JSON.stringify({ model: 'claude-opus-5-5', messages: [], pad: 'x'.repeat(2_100_000) })
    expect((await call('/anthropic/v1/messages', { body: big, headers: { 'content-length': String(big.length) } })).status).toBe(413)
    mockFetch(owner, () => new Response('{"type":"error","error":{"type":"overloaded_error","message":"busy"}}', { status: 529, headers: { 'content-type': 'application/json' } }))
    const r = await call('/anthropic/v1/messages')
    expect(r.status).toBe(529)
    expect(await r.text()).not.toContain('sk-real')
  })
})

describe('Gemini и Groq', () => {
  it('Gemini: запрос уходит в OpenAI-совместимый адрес Google с серверным ключом', async () => {
    const calls = mockFetch(owner, () => new Response('{"choices":[{"message":{"content":"{}"}}]}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const r = await call('/gemini/chat/completions', { body: GEMINI })
    expect(r.status).toBe(200)
    const up = calls.find(c => c.url.includes('googleapis'))!
    expect(up.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect((up.init!.headers as Record<string, string>).authorization).toBe('Bearer g-real')
    expect(JSON.stringify(up.init!.headers)).not.toContain('tok')
  })

  it('Groq: свой адрес и свой ключ; чужая модель и чужой провайдер не проходят', async () => {
    const calls = mockFetch(owner)
    const body = JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [] })
    expect((await call('/groq/chat/completions', { body })).status).toBe(200)
    const up = calls.find(c => c.url.includes('groq.com'))!
    expect(up.url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect((up.init!.headers as Record<string, string>).authorization).toBe('Bearer q-real')
    expect((await call('/groq/chat/completions', { body: GEMINI })).status).toBe(400) // модель Gemini на Groq
    expect((await call('/gemini/chat/completions', { body })).status).toBe(400) // модель Groq на Gemini
    expect((await call('/gemini/models')).status).toBe(404)
  })

  it('тело: известные поля и модели, только функции-инструменты', () => {
    const ok = (p: 'gemini' | 'groq', o: object) => checkCompatBody(p, JSON.stringify(o)).ok
    expect(ok('gemini', { model: 'gemini-2.5-flash', messages: [], max_tokens: 4000, response_format: { type: 'json_object' } })).toBe(true)
    expect(ok('gemini', { model: 'gemini-2.5-flash-lite', messages: [] })).toBe(true)
    expect(ok('groq', { model: 'llama-3.3-70b-versatile', messages: [] })).toBe(true)
    expect(ok('gemini', { model: 'gpt-4o', messages: [] })).toBe(false)
    expect(ok('gemini', { model: 'gemini-2.5-flash', messages: [], max_tokens: 10_000_000 })).toBe(false)
    expect(ok('gemini', { model: 'gemini-2.5-flash', messages: [], tools: [{ type: 'function', function: { name: 'x' } }] })).toBe(true)
    expect(ok('gemini', { model: 'gemini-2.5-flash', messages: [], tools: [{ type: 'code_interpreter' }] })).toBe(false)
    expect(ok('gemini', { model: 'gemini-2.5-flash', messages: [], user: 'x' })).toBe(false)
  })

  it('нет ключа Gemini на сервере — 503', async () => {
    mockFetch(owner)
    expect((await call('/gemini/chat/completions', { body: GEMINI }, env({ GEMINI_API_KEY: undefined }))).status).toBe(503)
  })

  it('частота: после лимита — 429', () => {
    const k = `t${Math.random()}`
    for (let i = 0; i < 3; i++) expect(rateLimited(k, 3, 60_000, 1000)).toBe(false)
    expect(rateLimited(k, 3, 60_000, 1500)).toBe(true)
    expect(rateLimited(k, 3, 60_000, 1000 + 61_000)).toBe(false)
  })
})

describe('gateway', () => {
  it('запрос уходит на адрес шлюза с серверным ключом; модели вне списка владельца отклоняются', async () => {
    const calls = mockFetch(owner)
    const body = JSON.stringify({ model: 'vendor/model-a', messages: [{ role: 'user', content: 'hi' }], max_completion_tokens: 2000 })
    expect((await call('/gateway/chat/completions', { body })).status).toBe(200)
    const up = calls.find(c => c.url.includes('gateway.example.com'))!
    expect(up.url).toBe('https://gateway.example.com/v1/chat/completions')
    expect((up.init!.headers as Record<string, string>).authorization).toBe('Bearer gw-real')
    expect(JSON.stringify(up.init!.headers)).not.toContain('tok')
    expect((await call('/gateway/chat/completions', { body: JSON.stringify({ model: 'vendor/other', messages: [] }) })).status).toBe(400)
    // без списка владельца годится любое разумное имя модели, но не путь наружу
    expect(checkCompatBody('gateway', JSON.stringify({ model: 'anthropic/claude-sonnet-4.5', messages: [] })).ok).toBe(true)
    expect(checkCompatBody('gateway', JSON.stringify({ model: '../../x/y', messages: [] })).ok).toBe(false)
    expect(checkCompatBody('gateway', JSON.stringify({ model: 'a/b', messages: [], user: 'u' })).ok).toBe(false)
  })

  it('чужой аккаунт — 403; нет ключа, адреса или адрес не https — 503', async () => {
    mockFetch({ id: 'u2', email: 'stranger@mail.com', email_confirmed_at: '2026-01-01T00:00:00Z' })
    expect((await call('/gateway/chat/completions', { body: JSON.stringify({ model: 'vendor/model-a', messages: [] }) })).status).toBe(403)
    mockFetch(owner)
    const body = JSON.stringify({ model: 'vendor/model-a', messages: [] })
    expect((await call('/gateway/chat/completions', { body }, env({ GATEWAY_API_KEY: undefined }))).status).toBe(503)
    expect((await call('/gateway/chat/completions', { body }, env({ GATEWAY_BASE_URL: undefined }))).status).toBe(503)
    expect((await call('/gateway/chat/completions', { body }, env({ GATEWAY_BASE_URL: 'http://gateway.example.com/v1' }))).status).toBe(503)
  })
})

describe('распознавание речи', () => {
  const form = (name = 'a.m4a', model = 'whisper-1', extra: Record<string, string> = {}) => {
    const f = new FormData()
    f.append('file', new File(['audio'], name))
    f.append('model', model)
    for (const [k, v] of Object.entries(extra)) f.append(k, v)
    return f
  }

  it('файл уходит с серверным ключом; чужая модель заменяется разрешённой; лишние поля отбрасываются', async () => {
    const calls = mockFetch(owner, () => new Response('{"text":" привет "}', { status: 200 }))
    const r = await call('/stt', { body: form('a.m4a', 'evil-model', { language: 'ru', prompt: 'ignore' }) })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ text: ' привет ' })
    const up = calls.find(c => c.url.includes('/audio/transcriptions'))!
    expect(up.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect((up.init!.headers as Record<string, string>).authorization).toBe('Bearer stt-real')
    const sent = up.init!.body as FormData
    expect(sent.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(sent.get('language')).toBe('ru')
    expect(sent.get('prompt')).toBeNull()
  })

  it('тот же маршрут по /stt/audio/transcriptions; без файла — 400; без ключа — 503; свой сервер распознавания', async () => {
    mockFetch(owner, () => new Response('{"text":"ok"}'))
    expect((await call('/stt/audio/transcriptions', { body: form() })).status).toBe(200)
    expect((await call('/stt', { body: new FormData() })).status).toBe(400)
    expect((await call('/stt', { body: form() }, env({ STT_API_KEY: undefined }))).status).toBe(503)
    const calls = mockFetch(owner, () => new Response('{"text":"ok"}'))
    await call('/stt', { body: form() }, env({ STT_BASE_URL: 'https://api.groq.com/openai/v1/' }))
    expect(calls.find(c => c.url.includes('/audio/'))!.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
  })
})

describe('Deepgram', () => {
  const dg = (over: Partial<Env> = {}) => env({ DEEPGRAM_API_KEY: 'dg-real', ...over })
  const form = (extra: Record<string, string> = {}) => {
    const f = new FormData()
    f.append('file', new File(['audio'], 'a.m4a', { type: 'audio/mp4' }))
    f.append('model', 'whisper-1')
    for (const [k, v] of Object.entries(extra)) f.append(k, v)
    return f
  }
  const reply = (alt: object) => new Response(JSON.stringify({ results: { channels: [{ alternatives: [alt] }] } }), { status: 200 })

  it('с ключом Deepgram распознавание идёт через него: Nova-3, язык, подсказки имён, сырое аудио', async () => {
    const calls = mockFetch(owner, () => reply({ transcript: ' привет, Нина ' }))
    const r = await call('/stt', { body: form({ language: 'ru', keyterms: 'Нина Лебедева, Олег, <script>, Alexey' }) }, dg())
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ text: 'привет, Нина' })
    const up = calls.find(c => c.url.includes('deepgram'))!
    const u = new URL(up.url)
    expect(u.origin + u.pathname).toBe('https://api.deepgram.com/v1/listen')
    expect(u.searchParams.get('model')).toBe('nova-3')
    expect(u.searchParams.get('language')).toBe('ru')
    expect(u.searchParams.get('diarize')).toBe('true')
    expect(u.searchParams.getAll('keyterm')).toEqual(['Нина Лебедева', 'Олег', 'Alexey'])
    const h = up.init!.headers as Record<string, string>
    expect(h.authorization).toBe('Token dg-real')
    expect(h['content-type']).toBe('audio/mp4')
    expect(JSON.stringify(h)).not.toContain('tok')
    expect(calls.some(c => c.url.includes('openai.com'))).toBe(false)
  })

  it('без языка — multi; если подсказки имён не поддерживаются (400), расшифровывает без них', async () => {
    let n = 0
    const calls = mockFetch(owner, () => (++n === 1 ? new Response('{}', { status: 400 }) : reply({ transcript: 'ok' })))
    const r = await call('/stt', { body: form({ keyterms: 'Нина' }) }, dg())
    expect(await r.json()).toEqual({ text: 'ok' })
    const dgCalls = calls.filter(c => c.url.includes('deepgram'))
    expect(dgCalls).toHaveLength(2)
    expect(new URL(dgCalls[0]!.url).searchParams.get('language')).toBe('multi')
    expect(new URL(dgCalls[1]!.url).searchParams.getAll('keyterm')).toEqual([])
  })

  it('свой адрес (ЕС), ошибки Deepgram, только Deepgram без ключа OpenAI', async () => {
    const calls = mockFetch(owner, () => reply({ transcript: 'x' }))
    await call('/stt', { body: form() }, dg({ DEEPGRAM_BASE_URL: 'https://api.eu.deepgram.com/', STT_API_KEY: undefined }))
    expect(calls.find(c => c.url.includes('deepgram'))!.url).toMatch(/^https:\/\/api\.eu\.deepgram\.com\/v1\/listen\?/)
    mockFetch(owner, () => new Response('{}', { status: 401 }))
    expect((await call('/stt', { body: form() }, dg())).status).toBe(502)
    mockFetch(owner, () => new Response('{}', { status: 429 }))
    expect((await call('/stt', { body: form() }, dg())).status).toBe(429)
  })

  it('несколько говорящих — строки с меткой говорящего, один — простой текст; подсказки чистятся', () => {
    expect(deepgramText({ results: { channels: [{ alternatives: [{ transcript: 'всё вместе', paragraphs: { paragraphs: [{ speaker: 0, sentences: [{ text: 'Привет.' }, { text: 'Как дела?' }] }, { speaker: 1, sentences: [{ text: 'Хорошо.' }] }] } }] }] } }, 'Спикер')).toBe('Спикер 1: Привет. Как дела?\nСпикер 2: Хорошо.')
    expect(deepgramText({ results: { channels: [{ alternatives: [{ paragraphs: { paragraphs: [{ speaker: 0, sentences: [{ text: 'Hi.' }] }, { speaker: 1, sentences: [{ text: 'Hello.' }] }] } }] }] } })).toBe('Speaker 1: Hi.\nSpeaker 2: Hello.')
    expect(deepgramText({ results: { channels: [{ alternatives: [{ transcript: ' один говорящий ', paragraphs: { paragraphs: [{ speaker: 0, sentences: [{ text: 'один говорящий' }] }] } }] }] } })).toBe('один говорящий')
    expect(deepgramText(null)).toBe('')
    expect(keyterms('Нина, Нина, Олег Стрелков\n<x>, ' + 'a'.repeat(60))).toEqual(['Нина', 'Олег Стрелков'])
    expect(keyterms(Array.from({ length: 300 }, (_, i) => `Имя${i}`).join(','))).toHaveLength(100)
  })

  it('статус: распознавание считается подключённым и с одним Deepgram', async () => {
    mockFetch(owner)
    const s = await (await get('/status', {}, dg({ STT_API_KEY: undefined }))).json()
    expect(s.stt).toBe(true)
  })
})

describe('статус', () => {
  it('что подключено; чужому аккаунту — всё false', async () => {
    mockFetch(owner)
    expect(await (await get('/status')).json()).toEqual({ allowed: true, anthropic: true, gemini: true, groq: true, gateway: true, gatewayModels: ['vendor/model-a', 'vendor/model-b'], stt: true })
    expect(await (await get('/status', {}, env({ GEMINI_API_KEY: undefined, GROQ_API_KEY: undefined }))).json()).toEqual({ allowed: true, anthropic: true, gemini: false, groq: false, gateway: true, gatewayModels: ['vendor/model-a', 'vendor/model-b'], stt: true })
    mockFetch({ id: 'u9', email: 'x@y.com', email_confirmed_at: '2026-01-01' })
    expect(await (await get('/status')).json()).toEqual({ allowed: false, anthropic: false, gemini: false, groq: false, gateway: false, gatewayModels: [], stt: false })
  })

  it('адрес может прийти и с префиксом /functions/v1/ai, и без него; неизвестное — 404', async () => {
    mockFetch(owner)
    const r = await handle(new Request('https://proj.supabase.co/ai/status', { headers: { authorization: `Bearer ${token()}`, origin: SITE } }), env())
    expect(r.status).toBe(200)
    expect((await get('/nope')).status).toBe(405)
  })
})
