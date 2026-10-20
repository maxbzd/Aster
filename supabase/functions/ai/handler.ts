/**
 * Server-side AI and speech-to-text keys — a Supabase Edge Function named `ai`.
 *
 * Keys live only in the function's secrets and never reach the browser. Only a signed-in owner can use them:
 * the request carries a Supabase session whose email must be listed in ALLOWED_EMAILS (an empty list closes access
 * for everyone). Requests are accepted only from the origins listed in ALLOWED_ORIGINS (your app's URL).
 *
 * Routes (after /functions/v1/ai):
 *   GET  /status                       which providers are configured and whether this account may use them
 *   POST /anthropic/v1/messages        Claude (and /count_tokens)
 *   POST /gemini/chat/completions      Google Gemini (OpenAI-compatible format)
 *   POST /groq/chat/completions        Groq: gpt-oss, Llama… (OpenAI-compatible format)
 *   POST /gateway/chat/completions     any OpenAI-compatible gateway you configure (OpenRouter, LiteLLM, Ollama, …)
 *   POST /stt                          speech-to-text: Deepgram (if DEEPGRAM_API_KEY is set) or an OpenAI-compatible
 *                                      server; /stt/audio/transcriptions is an alias
 *
 * This file does not depend on Deno: the environment is passed in as a parameter, so ordinary tests can exercise it.
 */

export interface Env {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  ANTHROPIC_API_KEY?: string
  GEMINI_API_KEY?: string
  GROQ_API_KEY?: string
  /** Key for an OpenAI-compatible gateway; used together with GATEWAY_BASE_URL. */
  GATEWAY_API_KEY?: string
  /** Base URL of the gateway including the version prefix, e.g. https://openrouter.ai/api/v1 */
  GATEWAY_BASE_URL?: string
  /** Comma-separated model ids offered in the app for the gateway, e.g. "anthropic/claude-sonnet-4.5,openai/gpt-5". */
  GATEWAY_MODELS?: string
  STT_API_KEY?: string
  /** Deepgram (Nova-3): when set, speech recognition goes through it. */
  DEEPGRAM_API_KEY?: string
  /** Deepgram base URL; defaults to https://api.deepgram.com (EU: https://api.eu.deepgram.com). */
  DEEPGRAM_BASE_URL?: string
  /** Base URL of the speech-to-text server; defaults to OpenAI. */
  STT_BASE_URL?: string
  /** Owner emails, comma-separated. */
  ALLOWED_EMAILS?: string
  /** App origins, comma-separated, e.g. https://aster.example.com */
  ALLOWED_ORIGINS?: string
}

export type Provider = 'anthropic' | 'gemini' | 'groq' | 'gateway'
type CompatProvider = Exclude<Provider, 'anthropic'>

export const MODEL_RE: Record<Provider, RegExp> = {
  /** Any Claude model (including ones with a date suffix). */
  anthropic: /^claude-(?:haiku|sonnet|opus|fable|mythos)-\d+(?:-\d+)?(?:-\d{8})?$/,
  gemini: /^gemini-[\d.]+-(?:flash|flash-lite|pro)(?:-[\w.-]+)?$/,
  groq: /^(?:openai\/gpt-oss-(?:20b|120b)|(?:meta-llama|qwen|moonshotai)\/[\w.-]+|llama-[\w.-]+)$/,
  /** Gateway: any sane model id, optionally with a vendor prefix (e.g. anthropic/claude-sonnet-4.5). */
  gateway: /^[\w][\w.:-]{0,60}(?:\/[\w][\w.:-]{0,60}){0,2}$/,
}
export const STT_MODELS = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1', 'whisper-large-v3-turbo', 'whisper-large-v3']

const ANTHROPIC_PATHS = new Set(['/v1/messages', '/v1/messages/count_tokens'])
const ANTHROPIC_KEYS = new Set(['model', 'max_tokens', 'system', 'messages', 'output_config', 'tools', 'thinking', 'fallbacks', 'metadata', 'temperature', 'top_p', 'top_k', 'stop_sequences', 'tool_choice', 'stream'])
const COMPAT_KEYS = new Set(['model', 'messages', 'max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'stop', 'response_format', 'stream', 'reasoning_effort', 'tools', 'tool_choice', 'n', 'seed', 'stream_options', 'parallel_tool_calls'])
const COMPAT_UPSTREAM: Record<Exclude<CompatProvider, 'gateway'>, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
}
const COMPAT_NAME: Record<CompatProvider, string> = { gemini: 'Gemini', groq: 'Groq', gateway: 'Gateway' }
const MAX_BODY = 2_000_000
const MAX_STT_BODY = 25 * 1024 * 1024
const MAX_TOKENS = 20_000
const AI_TIMEOUT = 140_000
const STT_TIMEOUT = 170_000

export interface AuthUser { id: string; email: string; confirmed: boolean }

/* ---------- utilities ---------- */

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } })

const list = (s?: string) => (s ?? '').split(/[,\s;]+/).map(x => x.trim()).filter(Boolean)
export const allowedEmails = (env: Pick<Env, 'ALLOWED_EMAILS'>) => list(env.ALLOWED_EMAILS).map(x => x.toLowerCase())
export const allowedOrigins = (env: Pick<Env, 'ALLOWED_ORIGINS'>) => list(env.ALLOWED_ORIGINS).map(x => x.replace(/\/$/, ''))

/** Only a confirmed email from the list may sign in. An empty list closes access. */
export function isAllowed(user: AuthUser | null, env: Pick<Env, 'ALLOWED_EMAILS'>): boolean {
  if (!user || !user.confirmed || !user.email) return false
  return allowedEmails(env).includes(user.email.toLowerCase())
}

const bearer = (req: Request) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  return m ? m[1]! : ''
}

/* ---------- CORS: your own sites only ---------- */

/** Headers for an allowed site. For a foreign Origin returns null and the request is rejected. localhost is allowed only if listed. */
export function corsFor(req: Request, env: Pick<Env, 'ALLOWED_ORIGINS'>): Record<string, string> | null {
  const origin = req.headers.get('origin')
  if (!origin) return {} // not from a browser (health checks, curl): a token is still required
  if (!allowedOrigins(env).includes(origin)) return null
  // The Anthropic SDK adds its own headers (x-stainless-*, anthropic-version…): allow whatever the browser asks for.
  // This is safe: the site itself was checked above, and a request without a token gets 401 anyway.
  const asked = (req.headers.get('access-control-request-headers') ?? '').replace(/[^\w\-, ]/g, '').slice(0, 500)
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': asked || 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

/* ---------- Supabase session check ---------- */

const userCache = new Map<string, { user: AuthUser | null; until: number }>()

/** Ask Supabase whose token this is. The answer is cached for a minute so we don't call it on every request. */
export async function verifyToken(token: string, env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'>, now = Date.now()): Promise<AuthUser | null> {
  if (!token || token.length > 4000 || !/^[\w.-]+$/.test(token)) return null
  const hit = userCache.get(token)
  if (hit && hit.until > now) return hit.user
  let user: AuthUser | null = null
  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const u = (await res.json()) as { id?: string; email?: string; email_confirmed_at?: string | null; confirmed_at?: string | null }
      if (u.id) user = { id: u.id, email: u.email ?? '', confirmed: !!(u.email_confirmed_at ?? u.confirmed_at) }
    }
  } catch { user = null }
  if (userCache.size > 200) userCache.clear()
  userCache.set(token, { user, until: now + (user ? 60_000 : 5_000) })
  return user
}

/* ---------- rate limiting (per function instance) ---------- */

const hits = new Map<string, number[]>()
export function rateLimited(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs)
  if (recent.length >= limit) { hits.set(key, recent); return true }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 500) hits.clear()
  return false
}

/* ---------- request body validation ---------- */

type Check = { ok: true } | { ok: false; message: string }

const parse = (raw: string): Record<string, unknown> | null => {
  try {
    const b = JSON.parse(raw) as unknown
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null
  } catch { return null }
}

/** Claude: known models, a bounded reply, custom tools and web search; code execution, MCP and the rest are closed. */
export function checkAnthropicBody(raw: string): Check {
  const b = parse(raw)
  if (!b) return { ok: false, message: 'Request body is not a JSON object' }
  for (const k of Object.keys(b)) if (!ANTHROPIC_KEYS.has(k)) return { ok: false, message: `Field "${k}" is not supported` }
  if (typeof b.model !== 'string' || !MODEL_RE.anthropic.test(b.model)) return { ok: false, message: 'This model is not allowed' }
  if (b.max_tokens !== undefined && (typeof b.max_tokens !== 'number' || b.max_tokens > MAX_TOKENS)) return { ok: false, message: 'The requested reply is too long' }
  if (b.tools !== undefined) {
    const okTool = (t: unknown) => {
      const type = (t as { type?: unknown } | null)?.type
      return type === undefined || type === 'custom' || (typeof type === 'string' && /^web_search_\d+$/.test(type))
    }
    if (!Array.isArray(b.tools) || !b.tools.every(okTool)) return { ok: false, message: 'This tool is not allowed' }
  }
  return { ok: true }
}

/** Gemini, Groq and the gateway (OpenAI format): known models, a bounded reply, function tools only. */
export function checkCompatBody(provider: CompatProvider, raw: string, allowedModels?: string[]): Check {
  const b = parse(raw)
  if (!b) return { ok: false, message: 'Request body is not a JSON object' }
  for (const k of Object.keys(b)) if (!COMPAT_KEYS.has(k)) return { ok: false, message: `Field "${k}" is not supported` }
  if (typeof b.model !== 'string' || !MODEL_RE[provider].test(b.model)) return { ok: false, message: 'This model is not allowed' }
  if (allowedModels && allowedModels.length > 0 && !allowedModels.includes(b.model)) return { ok: false, message: 'This model is not allowed' }
  for (const k of ['max_tokens', 'max_completion_tokens'] as const) if (b[k] !== undefined && (typeof b[k] !== 'number' || (b[k] as number) > MAX_TOKENS)) return { ok: false, message: 'The requested reply is too long' }
  if (b.tools !== undefined && (!Array.isArray(b.tools) || !b.tools.every(t => (t as { type?: unknown } | null)?.type === 'function'))) return { ok: false, message: 'This tool is not allowed' }
  return { ok: true }
}

const BETA = /^[\w.,\s-]{1,200}$/

/* ---------- handlers ---------- */

/** Model ids the owner offers through the gateway (GATEWAY_MODELS). */
export const gatewayModels = (env: Pick<Env, 'GATEWAY_MODELS'>) => list(env.GATEWAY_MODELS)

/** Chat-completions URL of the gateway, or '' when it is not configured or the URL is not https. */
export function gatewayUrl(env: Pick<Env, 'GATEWAY_BASE_URL'>): string {
  try {
    const u = new URL(env.GATEWAY_BASE_URL ?? '')
    if (u.protocol !== 'https:') return ''
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}/chat/completions`
  } catch { return '' }
}

const keyFor = (env: Env, p: Provider) => (p === 'anthropic' ? env.ANTHROPIC_API_KEY : p === 'gemini' ? env.GEMINI_API_KEY : p === 'groq' ? env.GROQ_API_KEY : env.GATEWAY_API_KEY)

async function readBody(req: Request): Promise<string | Response> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json(413, { error: { type: 'request_too_large', message: 'Request too large' } })
  const raw = await req.text()
  return raw.length > MAX_BODY ? json(413, { error: { type: 'request_too_large', message: 'Request too large' } }) : raw
}

const pass = (up: Response) => {
  const out: Record<string, string> = { 'content-type': up.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' }
  for (const h of ['retry-after', 'request-id', 'x-request-id']) { const v = up.headers.get(h); if (v) out[h] = v }
  return new Response(up.body, { status: up.status, headers: out })
}

async function handleAnthropic(req: Request, env: Env, path: string, search: string): Promise<Response> {
  const key = env.ANTHROPIC_API_KEY
  const err = (status: number, type: string, message: string) => json(status, { type: 'error', error: { type, message } })
  if (!key) return err(503, 'api_error', 'The Anthropic key is not set on the server')
  if (!ANTHROPIC_PATHS.has(path)) return err(404, 'not_found_error', 'Not found')
  const raw = await readBody(req)
  if (raw instanceof Response) return raw
  const check = checkAnthropicBody(raw)
  if (!check.ok) return err(400, 'invalid_request_error', check.message)
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  const beta = req.headers.get('anthropic-beta')
  if (beta && BETA.test(beta)) headers['anthropic-beta'] = beta
  try { return pass(await fetch(`https://api.anthropic.com${path}${search === '?beta=true' ? '?beta=true' : ''}`, { method: 'POST', headers, body: raw, signal: AbortSignal.timeout(AI_TIMEOUT) })) }
  catch { return err(502, 'api_error', 'Could not reach Anthropic') }
}

async function handleCompat(provider: CompatProvider, req: Request, env: Env): Promise<Response> {
  const key = keyFor(env, provider)
  const err = (status: number, message: string) => json(status, { error: { message } })
  const upstream = provider === 'gateway' ? gatewayUrl(env) : COMPAT_UPSTREAM[provider]
  if (!key || !upstream) return err(503, `${COMPAT_NAME[provider]} is not configured on the server`)
  const raw = await readBody(req)
  if (raw instanceof Response) return raw
  const check = checkCompatBody(provider, raw, provider === 'gateway' ? gatewayModels(env) : undefined)
  if (!check.ok) return err(400, check.message)
  try { return pass(await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: raw, signal: AbortSignal.timeout(AI_TIMEOUT) })) }
  catch { return err(502, 'Could not reach the AI server') }
}

const KEYTERM = /^[\p{L}\p{N}][\p{L}\p{N} .'’-]{0,38}$/u

/** Words worth recognising more precisely (names of people in the network): up to 100, letters and digits only. */
export function keyterms(raw: unknown): string[] {
  return [...new Set(String(raw ?? '').split(/[,\n]/).map(x => x.trim()).filter(x => KEYTERM.test(x)))].slice(0, 100)
}

interface DeepgramReply { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string; paragraphs?: { paragraphs?: Array<{ speaker?: number; sentences?: Array<{ text?: string }> }> } }> }> } }

/** Text from a Deepgram reply. With two or more speakers each line gets a "Speaker N:" label; with one it is plain text. */
export function deepgramText(data: DeepgramReply | null, label = 'Speaker'): string {
  const alt = data?.results?.channels?.[0]?.alternatives?.[0]
  const paras = alt?.paragraphs?.paragraphs ?? []
  const speakers = new Set(paras.map(p => p.speaker).filter(x => x !== undefined))
  if (speakers.size > 1) {
    return paras.map(p => `${label} ${(p.speaker ?? 0) + 1}: ${(p.sentences ?? []).map(x => x.text ?? '').join(' ').trim()}`).filter(l => !l.endsWith(': ')).join('\n')
  }
  return (alt?.transcript ?? '').trim()
}

async function deepgram(file: Blob, lang: string, terms: string[], label: string, env: Env): Promise<Response> {
  const body = await file.arrayBuffer()
  const call = (withTerms: boolean) => {
    const q = new URLSearchParams({ model: 'nova-3', smart_format: 'true', paragraphs: 'true', diarize: 'true', language: lang || 'multi' })
    if (withTerms) for (const t of terms) q.append('keyterm', t)
    return fetch(`${(env.DEEPGRAM_BASE_URL || 'https://api.deepgram.com').replace(/\/$/, '')}/v1/listen?${q}`, {
      method: 'POST', headers: { authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'content-type': file.type || 'application/octet-stream' }, body, signal: AbortSignal.timeout(STT_TIMEOUT),
    })
  }
  let up: Response
  try {
    up = await call(terms.length > 0)
    // some languages don't support name hints (400): transcribe without them instead of failing
    if (up.status === 400 && terms.length > 0) up = await call(false)
  } catch { return json(502, { error: 'Could not reach Deepgram' }) }
  if (!up.ok) return json(up.status === 429 ? 429 : 502, { error: `Deepgram returned an error (${up.status})` })
  return json(200, { text: deepgramText((await up.json().catch(() => null)) as DeepgramReply | null, label) })
}

async function handleStt(req: Request, env: Env): Promise<Response> {
  if (!env.DEEPGRAM_API_KEY && !env.STT_API_KEY) return json(503, { error: 'The speech-recognition key is not set on the server' })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_STT_BODY + 4096) return json(413, { error: 'File too large' })
  let form: FormData
  try { form = await req.formData() } catch { return json(400, { error: 'Expected a multipart form' }) }
  const file = form.get('file')
  if (!(file instanceof Blob) || file.size === 0) return json(400, { error: 'No file' })
  if (file.size > MAX_STT_BODY) return json(413, { error: 'File too large' })
  const model = String(form.get('model') ?? '')
  const lang = String(form.get('language') ?? '')
  const okLang = /^[a-z]{2,3}(-[A-Za-z]{2})?$/.test(lang) ? lang : ''
  // the client may name the speaker label in the user's language ("Speaker", "Спикер", …)
  const label = /^[\p{L}]{1,20}$/u.test(String(form.get('speaker_label') ?? '')) ? String(form.get('speaker_label')) : 'Speaker'
  if (env.DEEPGRAM_API_KEY) return deepgram(file, okLang, keyterms(form.get('keyterms')), label, env)
  const out = new FormData()
  out.append('file', file, (file as File).name || 'audio')
  out.append('model', STT_MODELS.includes(model) ? model : STT_MODELS[0]!)
  if (okLang) out.append('language', okLang)
  out.append('response_format', 'json')
  let up: Response
  try { up = await fetch(`${(env.STT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${env.STT_API_KEY}` }, body: out, signal: AbortSignal.timeout(STT_TIMEOUT) }) }
  catch { return json(502, { error: 'Could not reach the speech-recognition server' }) }
  if (!up.ok) return json(up.status === 429 ? 429 : 502, { error: `The speech-recognition server returned an error (${up.status})` })
  const data = (await up.json().catch(() => null)) as { text?: string } | null
  return json(200, { text: typeof data?.text === 'string' ? data.text : '' })
}

const withCors = (res: Response, cors: Record<string, string>) => {
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const cors = corsFor(req, env)
  if (cors === null) return json(403, { error: 'Forbidden' })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'cache-control': 'no-store' } })
  return withCors(await route(req, env), cors)
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/(?:functions\/v1\/)?ai(?=\/|$)/, '').replace(/\/+$/, '') || '/'
  const user = await verifyToken(bearer(req), env)
  if (!user) return json(401, { error: 'Sign-in required', type: 'error' })

  if (path === '/status') {
    const ok = isAllowed(user, env)
    return json(200, { allowed: ok, anthropic: ok && !!env.ANTHROPIC_API_KEY, gemini: ok && !!env.GEMINI_API_KEY, groq: ok && !!env.GROQ_API_KEY, gateway: ok && !!env.GATEWAY_API_KEY && !!gatewayUrl(env), gatewayModels: ok && env.GATEWAY_API_KEY && gatewayUrl(env) ? gatewayModels(env) : [], stt: ok && !!(env.DEEPGRAM_API_KEY || env.STT_API_KEY) })
  }
  if (!isAllowed(user, env)) return json(403, { error: 'Server keys are not available to this account', type: 'error' })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const m = /^\/(anthropic|gemini|groq|gateway)(\/.*)$/.exec(path)
  if (m) {
    const provider = m[1] as Provider
    if (rateLimited(`ai:${user.id}`, 40)) return json(429, { error: 'Too many requests — wait a minute', type: 'error' })
    if (provider === 'anthropic') return handleAnthropic(req, env, m[2]!, url.search)
    if (m[2] !== '/chat/completions') return json(404, { error: 'Not found' })
    return handleCompat(provider, req, env)
  }
  if (path === '/stt' || path === '/stt/audio/transcriptions') {
    if (rateLimited(`stt:${user.id}`, 20)) return json(429, { error: 'Too many requests — wait a minute' })
    return handleStt(req, env)
  }
  return json(404, { error: 'Not found' })
}
