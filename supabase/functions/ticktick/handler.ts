/**
 * TickTick link: the Supabase Edge Function `ticktick`.
 *
 * Tasks from the app (reminders in Aster; tasks and commitments in the companion app Orbita) are carried over to TickTick, and the "done"
 * mark travels both ways. Tasks from TickTick do NOT come into the app: the app only learns which of its own tasks have been closed.
 *
 * Function secrets: TICKTICK_CLIENT_ID, TICKTICK_CLIENT_SECRET (an app on developer.ticktick.com), ALLOWED_EMAILS, ALLOWED_ORIGINS.
 * The TickTick token and the links "app record ↔ TickTick task" live in the tables ticktick_tokens and ticktick_links; ordinary clients cannot read them.
 *
 * Routes (after /functions/v1/ticktick):
 *   GET  /callback?code&state   the return from TickTick after consent (no app sign-in: the signature of state is checked)
 *   GET  /status                is TickTick connected
 *   POST /connect               {returnTo} → {url}: where to send the person for consent
 *   POST /disconnect            forget the token
 *   POST /sync                  {open:[{key,title,notes?,dueAt?,dueDay?,priority?}], done:[key], tz?} → {completed:[key], created, closed, errors}
 *
 * The file does not depend on Deno: the environment and the database access come in as parameters, so ordinary tests can exercise it.
 * The same file lives in Aster and in Orbita: edit it in one place and update the copy in the other.
 */

export interface Env {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  TICKTICK_CLIENT_ID?: string
  TICKTICK_CLIENT_SECRET?: string
  ALLOWED_EMAILS?: string
  ALLOWED_ORIGINS?: string
}

export interface TokenRow { user_id: string; access_token: string; refresh_token?: string | null; expires_at?: string | null; scope?: string | null }
export interface LinkRow { user_id: string; key: string; task_id: string; project_id: string; completed: boolean; gone: boolean }

/** Access to the tables. The real one goes through PostgREST with the service key; tests use memory. */
export interface Db {
  getToken(uid: string): Promise<TokenRow | null>
  putToken(row: TokenRow): Promise<void>
  deleteToken(uid: string): Promise<void>
  getLinks(uid: string): Promise<LinkRow[]>
  /** Claim a key: true if there was no link yet and it has just been created (exactly one of concurrent requests wins). */
  claimLink(uid: string, key: string): Promise<boolean>
  setLink(uid: string, key: string, patch: Partial<Pick<LinkRow, 'task_id' | 'project_id' | 'completed' | 'gone'>>): Promise<void>
  dropLink(uid: string, key: string): Promise<void>
}

export interface Deps { db?: Db; now?: number }

const TT_AUTH = 'https://ticktick.com/oauth/authorize'
const TT_TOKEN = 'https://ticktick.com/oauth/token'
const TT_API = 'https://api.ticktick.com/open/v1'
const SCOPE = 'tasks:write tasks:read'

const KEY_RE = /^(?:aster|orbita):[a-z_]{1,20}:[\w.-]{1,100}$/
const MAX_OPEN = 300
const MAX_CREATE_PER_SYNC = 40
const MAX_CHECK_PER_SYNC = 25

/* ---------- shared helpers (the same as in the ai function) ---------- */

export const allowedEmails = (env: Pick<Env, 'ALLOWED_EMAILS'>) => (env.ALLOWED_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
export const allowedOrigins = (env: Pick<Env, 'ALLOWED_ORIGINS'>) => (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean)

interface AuthUser { id: string; email: string; confirmed: boolean }

export function isAllowed(user: AuthUser | null, env: Pick<Env, 'ALLOWED_EMAILS'>): boolean {
  if (!user || !user.confirmed || !user.email) return false
  return allowedEmails(env).includes(user.email.toLowerCase())
}

const bearer = (req: Request) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  return m ? m[1]! : ''
}

export function corsFor(req: Request, env: Pick<Env, 'ALLOWED_ORIGINS'>): Record<string, string> | null {
  const origin = req.headers.get('origin')
  if (!origin) return {}
  if (!allowedOrigins(env).includes(origin)) return null
  const asked = (req.headers.get('access-control-request-headers') ?? '').replace(/[^\w\-, ]/g, '').slice(0, 500)
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': asked || 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

const userCache = new Map<string, { user: AuthUser | null; until: number }>()

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

const hits = new Map<string, number[]>()
export function rateLimited(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs)
  if (recent.length >= limit) { hits.set(key, recent); return true }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 500) hits.clear()
  return false
}

const reply = (status: number, body: unknown, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors } })

/* ---------- signing state (protects the return from TickTick against forgery) ---------- */

const enc = new TextEncoder()
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))))
}

export interface StatePayload { uid: string; exp: number; ret: string }

export async function signState(p: StatePayload, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)))
  return `${body}.${await hmac(secret, body)}`
}

export async function readState(state: string, secret: string, now = Date.now()): Promise<StatePayload | null> {
  const [body, sig] = state.split('.')
  if (!body || !sig || state.length > 1500) return null
  const good = await hmac(secret, body)
  if (good.length !== sig.length) return null
  let diff = 0
  for (let i = 0; i < good.length; i++) diff |= good.charCodeAt(i) ^ sig.charCodeAt(i)
  if (diff !== 0) return null
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64url(body))) as StatePayload
    return p && typeof p.uid === 'string' && typeof p.ret === 'string' && typeof p.exp === 'number' && p.exp > now ? p : null
  } catch { return null }
}

/** Where to send the person back: only to an address of one of your own sites. */
export function safeReturn(ret: unknown, env: Pick<Env, 'ALLOWED_ORIGINS'>): string | null {
  if (typeof ret !== 'string' || ret.length > 500) return null
  try {
    const u = new URL(ret)
    return allowedOrigins(env).includes(u.origin) ? u.toString() : null
  } catch { return null }
}

/* ---------- time ---------- */

/** `2026-10-12T07:30:00.000Z` → `2026-10-12T07:30:00+0000` (TickTick's date format). */
export const ttDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '+0000')

/** The start of a local day in a time zone: the instant at which 00:00 of the given date arrives in that zone. */
export function startOfZonedDay(day: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0)
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    const offsetAt = (t: number) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, Number(x.value)])) as Record<string, number>
      return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - t
    }
    let t = guess - offsetAt(guess)
    t = guess - offsetAt(t)
    return new Date(t)
  } catch { return new Date(guess) }
}

/* ---------- parsing the request ---------- */

export interface SyncItem { key: string; title: string; notes?: string; dueAt?: string; dueDay?: string; priority?: 'low' | 'normal' | 'high' }
export interface SyncBody { open: SyncItem[]; done: string[]; tz: string }

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

export function parseSync(raw: unknown): SyncBody | string {
  if (!raw || typeof raw !== 'object') return 'A JSON object is required'
  const b = raw as Record<string, unknown>
  const open = Array.isArray(b.open) ? b.open : []
  const done = Array.isArray(b.done) ? b.done : []
  if (open.length > MAX_OPEN || done.length > MAX_OPEN) return 'Too many records at once'
  const tz = typeof b.tz === 'string' && /^[A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+){0,2}$/.test(b.tz) ? b.tz : 'UTC'
  const items: SyncItem[] = []
  for (const it of open) {
    if (!it || typeof it !== 'object') return 'A record must be an object'
    const i = it as Record<string, unknown>
    if (typeof i.key !== 'string' || !KEY_RE.test(i.key)) return 'Invalid record key'
    if (typeof i.title !== 'string' || !i.title.trim()) return 'The record has no title'
    const item: SyncItem = { key: i.key, title: i.title.trim().slice(0, 200) }
    if (typeof i.notes === 'string' && i.notes.trim()) item.notes = i.notes.trim().slice(0, 1500)
    if (typeof i.dueAt === 'string' && !Number.isNaN(Date.parse(i.dueAt))) item.dueAt = i.dueAt
    else if (isDay(i.dueDay)) item.dueDay = i.dueDay
    if (i.priority === 'low' || i.priority === 'normal' || i.priority === 'high') item.priority = i.priority
    items.push(item)
  }
  const keys: string[] = []
  for (const k of done) {
    if (typeof k !== 'string' || !KEY_RE.test(k)) return 'Invalid record key'
    keys.push(k)
  }
  return { open: items, done: keys, tz }
}

const PRIORITY: Record<NonNullable<SyncItem['priority']>, number> = { low: 1, normal: 0, high: 5 }

export function taskBody(it: SyncItem, tz: string): Record<string, unknown> {
  const body: Record<string, unknown> = { title: it.title, timeZone: tz }
  if (it.notes) body.content = it.notes
  if (it.priority) body.priority = PRIORITY[it.priority]
  if (it.dueAt) { body.dueDate = ttDate(new Date(it.dueAt)); body.isAllDay = false }
  else if (it.dueDay) { body.dueDate = ttDate(startOfZonedDay(it.dueDay, tz)); body.isAllDay = true }
  return body
}

/* ---------- calls to TickTick ---------- */

class TickTickError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function tt(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${TT_API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(15000) })
  const text = await res.text()
  if (!res.ok) throw new TickTickError(res.status, text.slice(0, 200))
  if (!text.trim()) return null
  try { return JSON.parse(text) } catch { return null }
}

const basic = (env: Pick<Env, 'TICKTICK_CLIENT_ID' | 'TICKTICK_CLIENT_SECRET'>) => `Basic ${btoa(`${env.TICKTICK_CLIENT_ID}:${env.TICKTICK_CLIENT_SECRET}`)}`

async function tokenRequest(env: Env, form: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string } | null> {
  try {
    const res = await fetch(TT_TOKEN, { method: 'POST', headers: { authorization: basic(env), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }
    return j.access_token ? { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: j.expires_in, scope: j.scope } : null
  } catch { return null }
}

const redirectUri = (env: Pick<Env, 'SUPABASE_URL'>) => `${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ticktick/callback`

function expiry(expiresIn: number | undefined, now: number) {
  return typeof expiresIn === 'number' && expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : null
}

/** A live token; an expired one is refreshed if TickTick issued a refresh_token. null: the person must connect again. */
async function liveToken(row: TokenRow, env: Env, db: Db, now: number): Promise<string | null> {
  const exp = row.expires_at ? Date.parse(row.expires_at) : Infinity
  if (exp > now + 60_000) return row.access_token
  if (!row.refresh_token) return null
  const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: row.refresh_token, scope: SCOPE })
  if (!t) return null
  await db.putToken({ user_id: row.user_id, access_token: t.access_token, refresh_token: t.refresh_token ?? row.refresh_token, expires_at: expiry(t.expires_in, now), scope: t.scope ?? row.scope })
  return t.access_token
}

/* ---------- sync ---------- */

interface TtTask { id?: string; projectId?: string; status?: number }

export interface SyncResult { completed: string[]; created: number; closed: number; errors: string[] }

export async function runSync(body: SyncBody, uid: string, token: string, db: Db): Promise<SyncResult> {
  const out: SyncResult = { completed: [], created: 0, closed: 0, errors: [] }
  const links = new Map((await db.getLinks(uid)).map(l => [l.key, l]))

  // 1. New app records → TickTick tasks. The key is claimed beforehand so that two devices never create the same task twice.
  let budget = MAX_CREATE_PER_SYNC
  for (const it of body.open) {
    if (links.has(it.key)) continue
    if (budget-- <= 0) break
    if (!(await db.claimLink(uid, it.key))) continue
    try {
      const t = (await tt(token, '/task', { method: 'POST', body: JSON.stringify(taskBody(it, body.tz)) })) as TtTask | null
      if (!t?.id) throw new TickTickError(502, 'TickTick did not return a task id')
      await db.setLink(uid, it.key, { task_id: t.id, project_id: t.projectId ?? '' })
      links.set(it.key, { user_id: uid, key: it.key, task_id: t.id, project_id: t.projectId ?? '', completed: false, gone: false })
      out.created++
    } catch (e) {
      await db.dropLink(uid, it.key)
      if (e instanceof TickTickError && e.status === 401) throw e
      out.errors.push(`«${it.title.slice(0, 40)}»: ${(e as Error).message}`)
      if (e instanceof TickTickError && e.status === 429) break
    }
  }

  // 2. Done in the app → close in TickTick.
  for (const key of body.done) {
    const l = links.get(key)
    if (!l || l.completed || l.gone || !l.task_id || l.task_id === 'pending') continue
    try {
      await tt(token, `/project/${encodeURIComponent(l.project_id)}/task/${encodeURIComponent(l.task_id)}/complete`, { method: 'POST' })
      await db.setLink(uid, key, { completed: true })
      l.completed = true
      out.closed++
    } catch (e) {
      if (e instanceof TickTickError && e.status === 404) { await db.setLink(uid, key, { gone: true }); l.gone = true; continue }
      if (e instanceof TickTickError && e.status === 401) throw e
      out.errors.push(`close ${key}: ${(e as Error).message}`)
    }
  }

  // 3. Done in TickTick → tell the app. Open links are checked by project lists: a list contains only unfinished tasks.
  const doneKeys = new Set(body.done)
  const watch = [...links.values()].filter(l => !l.completed && !l.gone && l.task_id && l.task_id !== 'pending' && !doneKeys.has(l.key))
  const byProject = new Map<string, LinkRow[]>()
  for (const l of watch) byProject.set(l.project_id, [...(byProject.get(l.project_id) ?? []), l])
  let checks = MAX_CHECK_PER_SYNC
  for (const [project, list] of byProject) {
    let undone: Set<string> | null = null
    try {
      const data = (await tt(token, `/project/${encodeURIComponent(project)}/data`)) as { tasks?: TtTask[] } | null
      undone = new Set((data?.tasks ?? []).map(t => t.id).filter((x): x is string => !!x))
    } catch (e) {
      if (e instanceof TickTickError && e.status === 401) throw e
      out.errors.push(`list ${project || 'inbox'}: ${(e as Error).message}`)
      continue
    }
    for (const l of list) {
      if (undone.has(l.task_id) || checks-- <= 0) continue
      try {
        const t = (await tt(token, `/project/${encodeURIComponent(project)}/task/${encodeURIComponent(l.task_id)}`)) as TtTask | null
        if (t?.status === 2) {
          await db.setLink(uid, l.key, { completed: true })
          l.completed = true
          out.completed.push(l.key)
        }
      } catch (e) {
        if (e instanceof TickTickError && e.status === 404) { await db.setLink(uid, l.key, { gone: true }); continue }
        if (e instanceof TickTickError && e.status === 401) throw e
        out.errors.push(`check ${l.key}: ${(e as Error).message}`)
      }
    }
  }

  // Closed in TickTick earlier, but the app still holds the record open (has not applied it yet): remind it.
  for (const it of body.open) {
    const l = links.get(it.key)
    if (l?.completed && !out.completed.includes(it.key) && !doneKeys.has(it.key)) out.completed.push(it.key)
  }
  return out
}

/* ---------- table access through PostgREST ---------- */

export function restDb(env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>): Db {
  const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`Database: ${res.status} ${(await res.text()).slice(0, 150)}`)
    const t = await res.text()
    return t ? JSON.parse(t) : null
  }
  const eq = (v: string) => `eq.${encodeURIComponent(v)}`
  return {
    async getToken(uid) { const r = (await call(`/ticktick_tokens?user_id=${eq(uid)}&select=*`)) as TokenRow[]; return r[0] ?? null },
    async putToken(row) { await call('/ticktick_tokens', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }) }) },
    async deleteToken(uid) { await call(`/ticktick_tokens?user_id=${eq(uid)}`, { method: 'DELETE' }) },
    async getLinks(uid) { return (await call(`/ticktick_links?user_id=${eq(uid)}&select=*&limit=5000`)) as LinkRow[] },
    async claimLink(uid, key) {
      const r = (await call('/ticktick_links?on_conflict=user_id,key', { method: 'POST', headers: { prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ user_id: uid, key, task_id: 'pending', project_id: '' }) })) as unknown[]
      return Array.isArray(r) && r.length > 0
    },
    async setLink(uid, key, patch) { await call(`/ticktick_links?user_id=${eq(uid)}&key=${eq(key)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) }) },
    async dropLink(uid, key) { await call(`/ticktick_links?user_id=${eq(uid)}&key=${eq(key)}&task_id=eq.pending`, { method: 'DELETE' }) },
  }
}

/* ---------- the handler itself ---------- */

const configured = (env: Env) => !!(env.TICKTICK_CLIENT_ID && env.TICKTICK_CLIENT_SECRET)

export async function handle(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const now = deps.now ?? Date.now()
  const url = new URL(req.url)
  const path = url.pathname.replace(/^.*\/ticktick/, '').replace(/\/$/, '') || '/'
  const cors = corsFor(req, env)

  // The return from TickTick is a browser navigation, not an app request: there is no Origin and no sign-in; the protection is the signature of state.
  if (path === '/callback' && req.method === 'GET') return callback(url, env, deps, now)

  if (cors === null) return reply(403, { error: 'This origin is not allowed' })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const user = await verifyToken(bearer(req), env, now)
  if (!user) return reply(401, { error: 'Sign in first' }, cors)
  if (!isAllowed(user, env)) return reply(403, { error: 'This account is not allowed to link TickTick' }, cors)
  const db = deps.db ?? restDb(env)
  if (rateLimited(`tt:${user.id}`, 40, 60_000, now)) return reply(429, { error: 'Too many requests' }, cors)

  if (path === '/status' && req.method === 'GET') {
    const t = configured(env) ? await db.getToken(user.id) : null
    const exp = t?.expires_at ? Date.parse(t.expires_at) : Infinity
    return reply(200, { configured: configured(env), connected: !!t && (exp > now || !!t.refresh_token), expiresAt: t?.expires_at ?? null }, cors)
  }

  if (path === '/disconnect' && req.method === 'POST') {
    await db.deleteToken(user.id)
    return reply(200, { ok: true }, cors)
  }

  if (path === '/connect' && req.method === 'POST') {
    if (!configured(env)) return reply(503, { error: 'TICKTICK_CLIENT_ID and TICKTICK_CLIENT_SECRET are not set on the server' }, cors)
    let b: { returnTo?: unknown } = {}
    try { b = (await req.json()) as typeof b } catch { /* no body */ }
    const ret = safeReturn(b.returnTo, env)
    if (!ret) return reply(400, { error: 'The return address is not in the allowed list' }, cors)
    const state = await signState({ uid: user.id, exp: now + 10 * 60_000, ret }, env.TICKTICK_CLIENT_SECRET!)
    const q = new URLSearchParams({ client_id: env.TICKTICK_CLIENT_ID!, scope: SCOPE, state, redirect_uri: redirectUri(env), response_type: 'code' })
    return reply(200, { url: `${TT_AUTH}?${q}` }, cors)
  }

  if (path === '/sync' && req.method === 'POST') {
    if (!configured(env)) return reply(503, { error: 'TickTick is not configured on the server' }, cors)
    let raw: unknown
    try { raw = await req.json() } catch { return reply(400, { error: 'The request body is not JSON' }, cors) }
    const body = parseSync(raw)
    if (typeof body === 'string') return reply(400, { error: body }, cors)
    const row = await db.getToken(user.id)
    if (!row) return reply(409, { error: 'not_connected' }, cors)
    const token = await liveToken(row, env, db, now)
    if (!token) return reply(409, { error: 'expired' }, cors)
    try {
      return reply(200, await runSync(body, user.id, token, db), cors)
    } catch (e) {
      if (e instanceof TickTickError && e.status === 401) { await db.deleteToken(user.id); return reply(409, { error: 'expired' }, cors) }
      return reply(502, { error: (e as Error).message }, cors)
    }
  }

  return reply(404, { error: 'No such route' }, cors)
}

async function callback(url: URL, env: Env, deps: Deps, now: number): Promise<Response> {
  const fail = (ret: string | null, code: string) => ret
    ? redirect(ret, code)
    : new Response('Could not connect TickTick. Close this tab and try again from the app.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  if (!configured(env)) return fail(null, 'config')
  const state = await readState(url.searchParams.get('state') ?? '', env.TICKTICK_CLIENT_SECRET!, now)
  if (!state) return fail(null, 'state')
  const ret = safeReturn(state.ret, env)
  const code = url.searchParams.get('code')
  if (!code || url.searchParams.get('error')) return fail(ret, 'denied')
  const t = await tokenRequest(env, { code, grant_type: 'authorization_code', scope: SCOPE, redirect_uri: redirectUri(env) })
  if (!t) return fail(ret, 'token')
  const db = deps.db ?? restDb(env)
  await db.putToken({ user_id: state.uid, access_token: t.access_token, refresh_token: t.refresh_token ?? null, expires_at: expiry(t.expires_in, now), scope: t.scope ?? SCOPE })
  return redirect(ret ?? '', 'ok')
}

function redirect(to: string, result: string): Response {
  if (!to) return new Response('Done. Return to the app.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  const u = new URL(to)
  u.searchParams.set('ticktick', result)
  return new Response(null, { status: 302, headers: { location: u.toString(), 'cache-control': 'no-store' } })
}
