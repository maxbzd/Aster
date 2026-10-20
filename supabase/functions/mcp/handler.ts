/**
 * Aster's MCP server for Claude: the Supabase Edge Function `mcp`.
 *
 * Through it Claude (in claude.ai, Claude Desktop and Claude Code) reads and writes Aster data: people, interactions, reminders.
 * To connect, the app (Profile → "Claude") creates a personal key and shows an address like
 *   https://<project>.supabase.co/functions/v1/mcp/<key>
 * which you add to Claude as a custom connector. Details are in docs/MCP.md.
 *
 * The file does not depend on Deno: the environment and the data access come in as parameters, so ordinary tests can exercise it.
 * The core (everything above the "APP TOOLS" banner) is the same in Aster and in the companion app Orbita.
 */

/* ========================================================================================================
 * MCP SERVER CORE. This block is the same in Aster and in Orbita (built from one source: edit it in one place and
 * update the other file). Below the "APP TOOLS" banner is what differs.
 *
 * MCP (Model Context Protocol) is a way to give Claude access to your data. This is a stateless "Streamable HTTP" server:
 * one address; Claude sends a JSON-RPC request each time and gets JSON back. Access is by a personal key in the address
 *   https://<project>.supabase.co/functions/v1/mcp/<key>
 * (or in the header Authorization: Bearer <key>). The key is created in the app, only its hash is stored in the database, and a button revokes it.
 * ======================================================================================================== */

export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  /** Owner emails, comma-separated (the same as for the other functions). */
  ALLOWED_EMAILS?: string
  /** The owner's time zone for dates without one; UTC by default. */
  MCP_TIMEZONE?: string
}

export class ToolError extends Error {}

export interface Row { id: string; data: Record<string, any> }

/** Access to the owner's data. The real one goes through PostgREST with the service key; tests use memory. */
export interface Store {
  list(uid: string, tbl: string): Promise<Row[]>
  put(uid: string, tbl: string, id: string, data: Record<string, any>): Promise<void>
}

export interface TokenInfo { id: string; user_id: string }

export interface Tokens {
  find(hash: string): Promise<TokenInfo | null>
  touch(id: string): Promise<void>
  email(uid: string): Promise<string | null>
}

export interface Deps { store?: Store; tokens?: Tokens; now?: number }

export interface Ctx { uid: string; store: Store; now: number; tz: string }

/* ---------- tool definitions ---------- */

type Args = Record<string, any>

export interface Prop {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description: string
  enum?: readonly string[]
  minimum?: number
  maximum?: number
  maxLength?: number
  items?: { type: 'string'; maxLength?: number } | { type: 'object'; properties: Record<string, { type: 'string'; description?: string; enum?: readonly string[] }>; required?: readonly string[] }
}

export interface Tool {
  name: string
  title: string
  description: string
  /** Only reads data. */
  readOnly?: boolean
  props: Record<string, Prop>
  required?: readonly string[]
  run(args: Args, ctx: Ctx): Promise<string>
}

export const toJsonSchema = (t: Tool) => ({
  type: 'object',
  properties: Object.fromEntries(Object.entries(t.props).map(([k, p]) => [k, { ...p }])),
  required: t.required ? [...t.required] : [],
  additionalProperties: false,
})

/** Validates arguments and coerces them gently: numbers and booleans from strings, a single string instead of a list. */
export function validate(tool: Tool, raw: unknown): Args {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Args) : {}
  const out: Args = {}
  for (const name of tool.required ?? []) {
    const v = src[name]
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) throw new ToolError(`The required field “${name}” is missing.`)
  }
  for (const [name, p] of Object.entries(tool.props)) {
    let v = src[name]
    if (v === undefined || v === null || v === '') continue
    if (p.type === 'string') {
      if (typeof v === 'number') v = String(v)
      if (typeof v !== 'string') throw new ToolError(`The field “${name}” must be a string.`)
      v = v.trim()
      if (p.maxLength && v.length > p.maxLength) throw new ToolError(`The field “${name}” is too long (at most ${p.maxLength} characters).`)
      if (p.enum && !p.enum.includes(v)) throw new ToolError(`The field “${name}” accepts only: ${p.enum.join(', ')}.`)
    } else if (p.type === 'number' || p.type === 'integer') {
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) v = Number(v)
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolError(`The field “${name}” must be a number.`)
      if (p.type === 'integer' && !Number.isInteger(v)) throw new ToolError(`The field “${name}” must be an integer.`)
      if (p.minimum !== undefined && v < p.minimum) throw new ToolError(`The field “${name}” must be at least ${p.minimum}.`)
      if (p.maximum !== undefined && v > p.maximum) throw new ToolError(`The field “${name}” must be at most ${p.maximum}.`)
    } else if (p.type === 'boolean') {
      if (v === 'true' || v === 'false') v = v === 'true'
      if (typeof v !== 'boolean') throw new ToolError(`The field “${name}” must be true or false.`)
    } else if (p.type === 'array') {
      if (!Array.isArray(v)) v = [v]
      if (v.length > 50) throw new ToolError(`The field “${name}” has too many items (at most 50).`)
      const it = p.items
      v = v.map((x: unknown) => {
        if (it?.type === 'object') {
          if (!x || typeof x !== 'object') throw new ToolError(`Items of “${name}” must be objects.`)
          const o: Args = {}
          for (const [k, sub] of Object.entries(it.properties)) {
            const sv = (x as Args)[k]
            if (sv === undefined || sv === null || sv === '') continue
            if (typeof sv !== 'string') throw new ToolError(`“${name}.${k}” must be a string.`)
            if (sub.enum && !sub.enum.includes(sv.trim())) throw new ToolError(`“${name}.${k}” accepts only: ${sub.enum.join(', ')}.`)
            o[k] = sv.trim().slice(0, 300)
          }
          for (const k of it.required ?? []) if (!o[k]) throw new ToolError(`Every item of “${name}” needs the field “${k}”.`)
          return o
        }
        if (typeof x !== 'string' && typeof x !== 'number') throw new ToolError(`Items of “${name}” must be strings.`)
        const s = String(x).trim()
        if (it?.maxLength && s.length > it.maxLength) throw new ToolError(`An item of “${name}” is too long.`)
        return s
      }).filter((x: unknown) => (typeof x === 'string' ? x !== '' : true))
    }
    out[name] = v
  }
  return out
}

/* ---------- time ---------- */

const pad = (n: number) => String(n).padStart(2, '0')

export interface Parts { y: number; m: number; d: number; h: number; mi: number; s: number; wd: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function zoneFormat(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' })
    fmtCache.set(tz, f)
  }
  return f
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function partsIn(ms: number, tz: string): Parts {
  const p = Object.fromEntries(zoneFormat(tz).formatToParts(new Date(ms)).map(x => [x.type, x.value])) as Record<string, string>
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second), wd: WD.indexOf(p.weekday!) }
}

/** The instant at which the clock in the time zone shows the given date and time. */
export function zonedInstant(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0)
  const offset = (t: number) => { const p = partsIn(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - t }
  let t = guess - offset(guess)
  t = guess - offset(t)
  return t
}

export const dayOf = (ms: number, tz: string) => { const p = partsIn(ms, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}` }

export const MONTHS_OF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "Mon, 12 October 2026" */
export function fmtDay(ms: number, tz: string): string {
  const p = partsIn(ms, tz)
  return `${WD[p.wd]}, ${p.d} ${MONTHS_OF[p.m - 1]} ${p.y}`
}

/** "Mon, 12 October 2026, 09:00" */
export function fmtWhen(ms: number, tz: string): string {
  const p = partsIn(ms, tz)
  return `${fmtDay(ms, tz)}, ${pad(p.h)}:${pad(p.mi)}`
}

export interface When { ms: number; dateOnly: boolean; day: string }

/**
 * A date or time from Claude. Accepts `YYYY-MM-DD` (a date without time), `YYYY-MM-DDTHH:MM` (by the owner's clock)
 * and a full ISO string with an offset (`…Z`, `…+03:00`). A date without time gets defaultHour.
 */
export function parseWhen(input: string, tz: string, defaultHour = 9): When {
  const s = input.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
    const probe = new Date(Date.UTC(y, mo - 1, d))
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) throw new ToolError(`There is no such date: “${s}”.`)
    return { ms: zonedInstant(y, mo, d, defaultHour, 0, tz), dateOnly: true, day: s }
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(s)
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5])
    if (h > 23 || mi > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) throw new ToolError(`Could not understand the date and time “${s}”.`)
    const ms = zonedInstant(y, mo, d, h, mi, tz)
    return { ms, dateOnly: false, day: dayOf(ms, tz) }
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const ms = Date.parse(s)
    if (!Number.isNaN(ms)) return { ms, dateOnly: false, day: dayOf(ms, tz) }
  }
  throw new ToolError(`Could not understand the date “${s}”. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM (for example, 2026-10-15T18:30).`)
}

export const daysBetweenDays = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000)

/** "today", "yesterday", "3 days ago", "tomorrow", "in 5 days". */
export function relDays(delta: number): string {
  if (delta === 0) return 'today'
  if (delta === -1) return 'yesterday'
  if (delta === 1) return 'tomorrow'
  const n = Math.abs(delta)
  return delta < 0 ? `${n} days ago` : `in ${n} days`
}

/* ---------- names ---------- */

export const lc = (s: string) => s.toLowerCase().replace(/ё/g, 'е')
export const uuid = () => crypto.randomUUID()

/** A word without its case ending, for languages that inflect names (Russian: "Олегу" → "олег"). Harmless for English names. */
const nameStem = (w: string) => w.replace(/[аеёиійоуыьэюя]+$/, '') || w

/** Every word of the query must match the start of some word of the name (in any case form): "Oleg" finds "Oleg Ivanov", "Iv" finds "Ivanov", "Oleg" does not find "Olesya". */
export function nameMatches(query: string, name: string): boolean {
  const q = lc(query).split(/[\s,.]+/).filter(Boolean).map(nameStem)
  const n = lc(name).split(/[\s,.]+/).filter(Boolean).map(nameStem)
  if (!q.length || !n.length) return false
  return q.every(w => w.length >= 2 && n.some(x => x.length >= 2 && (x.startsWith(w) || w.startsWith(x))))
}

/* ---------- rate limiting and caches ---------- */

const hits = new Map<string, number[]>()
export function rateLimited(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs)
  if (recent.length >= limit) { hits.set(key, recent); return true }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 500) hits.clear()
  return false
}

const emailCache = new Map<string, { ok: boolean; until: number }>()
const touched = new Map<string, number>()

/* ---------- JSON-RPC ---------- */

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY = 200_000

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')

export const TOKEN_RE = /^[a-f0-9]{64}$/

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization, accept, mcp-protocol-version, mcp-session-id',
  'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
  'access-control-expose-headers': 'mcp-session-id',
  'access-control-max-age': '86400',
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...extra } })

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

const allowedEmails = (env: Pick<Env, 'ALLOWED_EMAILS'>) => (env.ALLOWED_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

export function restTokens(env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>): Tokens {
  const base = env.SUPABASE_URL.replace(/\/$/, '')
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }
  return {
    async find(hash) {
      const res = await fetch(`${base}/rest/v1/mcp_tokens?token_hash=eq.${hash}&revoked_at=is.null&select=id,user_id&limit=1`, { headers, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`Database: ${res.status}`)
      const r = (await res.json()) as TokenInfo[]
      return r[0] ?? null
    },
    async touch(id) {
      await fetch(`${base}/rest/v1/mcp_tokens?id=eq.${id}`, { method: 'PATCH', headers: { ...headers, prefer: 'return=minimal' }, body: JSON.stringify({ last_used_at: new Date().toISOString() }), signal: AbortSignal.timeout(8000) })
    },
    async email(uid) {
      const res = await fetch(`${base}/auth/v1/admin/users/${uid}`, { headers, signal: AbortSignal.timeout(8000) })
      if (!res.ok) return null
      const u = (await res.json()) as { email?: string; email_confirmed_at?: string | null; confirmed_at?: string | null }
      return u.email && (u.email_confirmed_at ?? u.confirmed_at) ? u.email.toLowerCase() : null
    },
  }
}

async function dispatch(msg: any, ctx: Ctx): Promise<unknown | null> {
  const id = msg?.id
  const isNote = msg && typeof msg === 'object' && !('id' in msg)
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isNote ? null : rpcError(id, -32600, 'Invalid request')
  if (isNote) return null // notifications (notifications/initialized and the like) need no reply

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion
      return { jsonrpc: '2.0', id, result: { protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: SERVER.name, title: SERVER.title, version: SERVER.version }, instructions: SERVER.instructions } }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: toJsonSchema(t), annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: false, idempotentHint: !!t.readOnly, openWorldHint: false } })) } }
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === msg.params?.name)
      if (!tool) return rpcError(id, -32602, `No such tool: ${String(msg.params?.name).slice(0, 60)}`)
      try {
        const args = validate(tool, msg.params?.arguments)
        const text = await tool.run(args, ctx)
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } }
      } catch (e) {
        const text = e instanceof ToolError ? e.message : 'Could not complete the request: internal error. Please try again.'
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } }
      }
    }
    case 'resources/list': return { jsonrpc: '2.0', id, result: { resources: [] } }
    case 'resources/templates/list': return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } }
    case 'prompts/list': return { jsonrpc: '2.0', id, result: { prompts: [] } }
    default:
      return rpcError(id, -32601, `Method not supported: ${msg.method.slice(0, 60)}`)
  }
}

export async function handle(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const now = deps.now ?? Date.now()
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' }, { allow: 'POST, OPTIONS' })

  const url = new URL(req.url)
  const tail = url.pathname.replace(/^.*\/mcp/, '').replace(/^\/+|\/+$/g, '')
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? ''
  const token = (tail || bearer).toLowerCase()
  if (!TOKEN_RE.test(token)) return json(401, { error: 'An access key is required: create one in the app (Profile → Claude).' })

  const tokens = deps.tokens ?? restTokens(env)
  let info: TokenInfo | null
  try { info = await tokens.find(await sha256(token)) } catch { return json(503, { error: 'The database is unavailable, try again later' }) }
  if (!info) return json(401, { error: 'The key was not found or has been revoked' })

  // The key works only while the owner's email is on the list (the same as for the other server functions).
  const cached = emailCache.get(info.user_id)
  let ok = cached && cached.until > now ? cached.ok : null
  if (ok === null) {
    const email = await tokens.email(info.user_id).catch(() => null)
    ok = !!email && allowedEmails(env).includes(email)
    emailCache.set(info.user_id, { ok, until: now + 5 * 60_000 })
  }
  if (!ok) return json(403, { error: 'This account is not allowed access' })
  if (rateLimited(`mcp:${info.id}`, 120, 60_000, now)) return json(429, { error: 'Too many requests, wait a minute' })
  if ((touched.get(info.id) ?? 0) < now - 60_000) { touched.set(info.id, now); void tokens.touch(info.id).catch(() => undefined) }

  const raw = await req.text()
  if (raw.length > MAX_BODY) return json(413, rpcError(null, -32600, 'Request too large'))
  let body: unknown
  try { body = JSON.parse(raw) } catch { return json(400, rpcError(null, -32700, 'Not valid JSON')) }

  const tz = env.MCP_TIMEZONE && /^[A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+){0,2}$/.test(env.MCP_TIMEZONE) ? env.MCP_TIMEZONE : 'UTC'
  const ctx: Ctx = { uid: info.user_id, store: deps.store ?? restStore(env), now, tz }

  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return json(400, rpcError(null, -32600, 'Empty or oversized batch'))
    const replies = (await Promise.all(body.map(m => dispatch(m, ctx)))).filter(r => r !== null)
    return replies.length ? json(200, replies) : new Response(null, { status: 202, headers: CORS })
  }
  const reply = await dispatch(body, ctx)
  return reply === null ? new Response(null, { status: 202, headers: CORS }) : json(200, reply)
}

/* ---------- shared helpers for tools ---------- */

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Reads a PostgREST table page by page (the server returns at most 1000 rows per request). */
export async function pagedGet(env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>, path: string): Promise<any[]> {
  const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  const out: any[] = []
  for (let page = 0; page < 30; page++) {
    const res = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}limit=1000&offset=${page * 1000}`, { headers, signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`Database: ${res.status} ${(await res.text()).slice(0, 120)}`)
    const rows = (await res.json()) as any[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

/* ========================================================================================================
 * APP TOOLS
 * ======================================================================================================== */

/* ---------- Aster: data access ---------- */

/** Records live in the table `records` (tbl, id, data, deleted, client_ts). Writes go through mcp_put, which maintains client_ts itself. */
export function restStore(env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>): Store {
  const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }
  return {
    async list(uid, tbl) {
      const rows = await pagedGet(env, `/records?user_id=eq.${uid}&tbl=eq.${tbl}&deleted=eq.false&select=id,data&order=id`)
      return rows.filter(r => r.data && typeof r.data === 'object')
    },
    async put(uid, tbl, id, data) {
      const res = await fetch(`${base}/rpc/mcp_put`, { method: 'POST', headers, body: JSON.stringify({ p_user: uid, p_tbl: tbl, p_id: id, p_data: data }), signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`Database: ${res.status} ${(await res.text()).slice(0, 150)}`)
    },
  }
}

const SERVER = {
  name: 'aster',
  title: 'Aster: people and relationships',
  version: '1.0.0',
  instructions: [
    "Aster is a personal CRM for networking: people, meetings and calls, reminders, and who is looking for what and who can help with what. The data belongs to the owner; whatever you record shows up in their app right away.",
    'How to work: to record a meeting or call, use log_interaction (the person can be given by name in words, "Oliver" or "Oliver Stone"; if several people match, the tool returns a list with ids, so pick the right one instead of guessing). Add a new person with add_person only if search_people does not find them. Use add_reminder for things to do later.',
    "Dates: YYYY-MM-DD or YYYY-MM-DDTHH:MM by the owner's clock. If you do not know today's date, call get_now. Turn relative dates (\"on Tuesday\", \"next week\") into a concrete date first.",
    "Do not make anything up: record only what the owner said. After recording, briefly confirm exactly what was saved. Reply in the owner's language.",
  ].join('\n'),
}

/* ---------- Aster: helpers ---------- */

const CLOSENESS_CADENCE: Record<number, number> = { 1: 14, 2: 30, 3: 90, 4: 180 }
const CLOSENESS_NAME: Record<number, string> = { 1: 'inner circle', 2: 'close ones', 3: 'network', 4: 'acquaintances' }
const CONTACT_TYPES = ['meeting', 'call', 'message', 'event', 'favor_given', 'favor_got', 'gift']
const TYPE_LABEL: Record<string, string> = { meeting: 'meeting', call: 'call', message: 'messages', event: 'event', favor_given: 'I helped', favor_got: 'they helped me', gift: 'gift', note: 'note' }
const CHANNELS = ['phone', 'telegram', 'whatsapp', 'email', 'instagram', 'linkedin', 'x', 'website', 'other']

const SEARCH_STOP = new Set(['ищет', 'ищу', 'ищут', 'кто', 'что', 'как', 'для', 'про', 'надо', 'нужен', 'нужна', 'нужны', 'человек', 'люди', 'есть', 'знает', 'умеет', 'who', 'what', 'how', 'for', 'about', 'need', 'needs', 'looking', 'person', 'people', 'knows', 'can', 'the', 'and', 'with', 'someone', 'anyone'])
const fullName = (p: any) => [p.firstName, p.lastName].filter(Boolean).join(' ')
const cadenceOf = (p: any): number => (p.familyOf || p.everyday || p.lifeStatus ? 0 : p.cadenceDays === undefined ? CLOSENESS_CADENCE[p.closeness] ?? 90 : p.cadenceDays)
const anchorOf = (p: any, tz: string): number => p.lastContactAt ?? (p.metAt ? parseWhen(p.metAt, tz, 12).ms : p.createdAt)

async function people(c: Ctx): Promise<any[]> {
  return (await c.store.list(c.uid, 'people')).map(r => r.data)
}

/** A person by id or by name in words. If several match, a clear error with a list, so the entry never goes to the wrong person. */
function resolvePerson(all: any[], ref: string): any {
  const byId = all.find(p => p.id === ref)
  if (byId) return byId
  const live = all.filter(p => !p.archived)
  const exact = live.filter(p => lc(fullName(p)) === lc(ref) || (p.nickname && lc(p.nickname) === lc(ref)))
  const found = exact.length ? exact : live.filter(p => nameMatches(ref, [fullName(p), p.nickname ?? ''].join(' ')))
  if (found.length === 1) return found[0]
  if (found.length === 0) throw new ToolError(`Could not find a person “${ref}”. Check the spelling with search_people or add them with add_person.`)
  throw new ToolError(`“${ref}” matches several people, be more specific (pass the id):\n${found.slice(0, 8).map(p => `• ${fullName(p)}${p.company ? `, ${p.company}` : ''}${p.city ? `, ${p.city}` : ''} ; id ${p.id}`).join('\n')}`)
}

function line(p: any, c: Ctx): string {
  const last = p.lastContactAt ? `last contact ${relDays(daysBetweenDays(dayOf(c.now, c.tz), dayOf(p.lastContactAt, c.tz)))}` : 'no contact yet'
  const job = [p.role, p.company].filter(Boolean).join(', ')
  return `• ${fullName(p)}${job ? ` — ${job}` : ''}${p.city ? ` · ${p.city}` : ''} · ${CLOSENESS_NAME[p.closeness] ?? 'network'} · ${last} · id ${p.id}`
}

const touch = (ms: number, data: any) => ({ ...data, updatedAt: ms })

async function interactionsOf(c: Ctx): Promise<any[]> {
  return (await c.store.list(c.uid, 'interactions')).map(r => r.data)
}

async function remindersOf(c: Ctx): Promise<any[]> {
  return (await c.store.list(c.uid, 'reminders')).map(r => r.data)
}

/** "YYYY-MM-DD" or "--MM-DD" → the next occurrence (the day, days until it, the age if the year is known). */
function nextOccurrence(date: string, todayDay: string): { day: string; days: number; turning?: number } | null {
  const m = /^(\d{4}|--)-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const y0 = Number(todayDay.slice(0, 4))
  for (const y of [y0, y0 + 1]) {
    const day = `${y}-${m[2]}-${m[3]}`
    if (m[2] === '02' && m[3] === '29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) continue
    const days = daysBetweenDays(todayDay, day)
    if (days >= 0) return { day, days, turning: m[1] === '--' ? undefined : y - Number(m[1]) }
  }
  return null
}

/* ---------- Aster: tools ---------- */

const PERSON_FIELDS: Record<string, Prop> = {
  company: { type: 'string', description: 'Company.', maxLength: 120 },
  role: { type: 'string', description: 'Job title or what they do.', maxLength: 120 },
  city: { type: 'string', description: 'City.', maxLength: 80 },
  closeness: { type: 'integer', description: 'Closeness: 1 inner circle, 2 close ones, 3 network (default), 4 acquaintances. It sets how often to remind about the contact.', minimum: 1, maximum: 4 },
  tags: { type: 'array', description: 'Interests and topics, one word or a short phrase each.', items: { type: 'string', maxLength: 40 } },
  birthday: { type: 'string', description: 'Birthday: YYYY-MM-DD, or --MM-DD if the year is unknown (for example --03-25).', maxLength: 10 },
  met_at: { type: 'string', description: 'The date they met, YYYY-MM-DD.', maxLength: 10 },
  met_place: { type: 'string', description: 'Where they met.', maxLength: 120 },
  met_story: { type: 'string', description: 'How they met, in a sentence or two.', maxLength: 500 },
  looking_for: { type: 'string', description: 'What the person is looking for now (used to suggest introductions).', maxLength: 300 },
  can_help_me: { type: 'string', description: 'How the person can help the owner.', maxLength: 300 },
  i_can_help: { type: 'string', description: 'How the owner can help this person.', maxLength: 300 },
  channels: { type: 'array', description: 'Ways to reach them.', items: { type: 'object', properties: { type: { type: 'string', enum: CHANNELS, description: 'Kind of contact' }, value: { type: 'string', description: 'Number, handle or address' } }, required: ['type', 'value'] } },
  facts: { type: 'array', description: 'Short facts about the person (children, hobbies, events). Added to those already saved.', items: { type: 'string', maxLength: 200 } },
  topics: { type: 'array', description: 'What to ask about next time you talk. Added to those already saved.', items: { type: 'string', maxLength: 200 } },
  notes: { type: 'string', description: 'Free-form notes. If the person already has notes, the new text is appended with the date.', maxLength: 2000 },
}

function applyFields(p: any, a: Args, c: Ctx): void {
  const set = (k: string, v: unknown) => { if (v !== undefined) p[k] = v }
  set('company', a.company); set('role', a.role); set('city', a.city)
  set('closeness', a.closeness); set('metPlace', a.met_place); set('metStory', a.met_story)
  set('lookingFor', a.looking_for); set('canHelpMe', a.can_help_me); set('iCanHelp', a.i_can_help)
  if (a.birthday !== undefined) {
    if (!/^(\d{4}|--)-\d{2}-\d{2}$/.test(a.birthday)) throw new ToolError('Birthday: use YYYY-MM-DD or --MM-DD.')
    p.birthday = a.birthday
  }
  if (a.met_at !== undefined) { parseWhen(a.met_at, c.tz); p.metAt = a.met_at.slice(0, 10) }
  if (a.tags) p.tags = [...new Set([...(p.tags ?? []), ...a.tags])]
  /** Adds to the list only what is not there yet (also among the new items themselves). */
  const addUnique = (list: any[], incoming: any[], keyOf: (x: any) => string, make: (x: any) => any) => {
    const have = new Set(list.map(keyOf))
    const out = [...list]
    for (const x of incoming) { const k = keyOf(x); if (!have.has(k)) { have.add(k); out.push(make(x)) } }
    return out
  }
  if (a.channels) p.channels = addUnique(p.channels ?? [], a.channels, (x: any) => `${x.type}:${lc(x.value)}`, (x: any) => x)
  if (a.facts) p.facts = addUnique(p.facts ?? [], a.facts.map((text: string) => ({ text })), (x: any) => lc(x.text), (x: any) => ({ icon: 'sparkle', text: x.text }))
  if (a.topics) p.topics = addUnique(p.topics ?? [], a.topics.map((text: string) => ({ text })), (x: any) => lc(x.text), (x: any) => ({ id: uuid(), text: x.text, done: false }))
  if (a.notes) p.notes = p.notes ? `${p.notes}\n\n${dayOf(c.now, c.tz)}: ${a.notes}` : a.notes
}

export const TOOLS: Tool[] = [
  {
    name: 'get_now',
    title: 'What time is it',
    description: 'The current date, weekday and time by the owner\'s clock. Call it when you need to turn "today", "tomorrow" or "on Friday" into a concrete date.',
    readOnly: true,
    props: {},
    async run(_a, c) {
      return `It is now ${fmtWhen(c.now, c.tz)} (${c.tz}). Today is ${dayOf(c.now, c.tz)}.`
    },
  },
  {
    name: 'today_overview',
    title: 'What is on today',
    description: 'A summary for today: overdue and today\'s reminders, upcoming birthdays and important dates (14 days), and who is due for a message. A good start for "what do I have today".',
    readOnly: true,
    props: {},
    async run(_a, c) {
      const today = dayOf(c.now, c.tz)
      const [ppl, rems] = await Promise.all([people(c), remindersOf(c)])
      const byId = new Map(ppl.map(p => [p.id, p]))
      const out: string[] = [`Today is ${fmtDay(c.now, c.tz)}.`]

      const open = rems.filter(r => !r.done).sort((a, b) => a.dueAt - b.dueAt)
      const late = open.filter(r => dayOf(r.dueAt, c.tz) < today)
      const todays = open.filter(r => dayOf(r.dueAt, c.tz) === today)
      const soon = open.filter(r => dayOf(r.dueAt, c.tz) > today && r.dueAt <= c.now + 7 * 86_400_000)
      const remLine = (r: any) => `• ${r.text}${r.personId && byId.get(r.personId) ? ` (${fullName(byId.get(r.personId))})` : ''} — ${fmtWhen(r.dueAt, c.tz)} · id ${r.id}`
      if (late.length) out.push('', `Overdue (${late.length}):`, ...late.slice(0, 15).map(remLine))
      if (todays.length) out.push('', `Due today (${todays.length}):`, ...todays.slice(0, 15).map(remLine))
      if (soon.length) out.push('', `Next 7 days (${soon.length}):`, ...soon.slice(0, 10).map(remLine))
      if (!late.length && !todays.length) out.push('', 'No reminders for today.')

      const dates: Array<{ days: number; text: string }> = []
      for (const p of ppl) {
        if (p.archived) continue
        if (p.birthday) {
          const n = nextOccurrence(p.birthday, today)
          if (n && n.days <= 14) dates.push({ days: n.days, text: `birthday: ${fullName(p)}${n.turning ? ` (turning ${n.turning})` : ''}, ${relDays(n.days)}` })
        }
        for (const d of p.importantDates ?? []) {
          const n = nextOccurrence(d.date, today)
          if (n && n.days <= 14 && (d.yearly !== false || n.days >= 0)) dates.push({ days: n.days, text: `${d.label}: ${fullName(p)}, ${relDays(n.days)}` })
        }
      }
      if (dates.length) out.push('', 'Dates in the next 14 days:', ...dates.sort((a, b) => a.days - b.days).slice(0, 12).map(d => `• ${d.text}`))

      const due = ppl
        .filter(p => !p.archived && !(p.snoozedUntil && p.snoozedUntil > c.now))
        .map(p => { const cad = cadenceOf(p); const since = Math.max(0, daysBetweenDays(dayOf(anchorOf(p, c.tz), c.tz), today)); return { p, cad, since, ratio: cad ? since / cad : 0 } })
        .filter(x => x.cad > 0 && x.ratio >= 1)
        .sort((a, b) => a.p.closeness - b.p.closeness || b.ratio - a.ratio)
      if (due.length) out.push('', `Due for a message (${due.length}, first 10 shown):`, ...due.slice(0, 10).map(x => `• ${fullName(x.p)}: ${CLOSENESS_NAME[x.p.closeness]}, no contact for ${x.since} days (rhythm ${x.cad} days) · id ${x.p.id}`))
      return out.join('\n')
    },
  },
  {
    name: 'search_people',
    title: 'Find people',
    description: 'Search people by name (any case form), company, role, city, interests, what they look for or can do, facts and notes. Without a query it returns the people you talked to most recently.',
    readOnly: true,
    props: {
      query: { type: 'string', description: 'What to look for: "Oliver", "investor", "Dubai", "looking for a CTO".', maxLength: 200 },
      limit: { type: 'integer', description: 'How many to return (default 15, at most 50).', minimum: 1, maximum: 50 },
    },
    async run(a, c) {
      const all = (await people(c)).filter(p => !p.archived)
      const limit = a.limit ?? 15
      let found = all
      if (a.query) {
        const q = lc(a.query)
        const words = q.split(/[\s,]+/).filter(w => w.length >= 3 && !SEARCH_STOP.has(w)).map(w => w.slice(0, Math.max(3, w.length - 2)))
        const scored = all.map(p => {
          const name = fullName(p) + ' ' + (p.nickname ?? '')
          const hay = lc([p.company, p.role, p.city, (p.tags ?? []).join(' '), p.lookingFor, p.canHelpMe, p.iCanHelp, p.notes, p.metPlace, p.metStory, (p.facts ?? []).map((f: any) => f.text).join(' ')].filter(Boolean).join(' '))
          const score = (nameMatches(a.query, name) ? 10 : 0) + (hay.includes(q) ? 4 : 0) + (words.length && words.every((w: string) => hay.includes(w)) ? 3 : 0)
          return { p, score }
        }).filter(x => x.score > 0)
        found = scored.sort((x, y) => y.score - x.score).map(x => x.p)
      } else {
        found = [...all].sort((x, y) => (y.lastContactAt ?? 0) - (x.lastContactAt ?? 0))
      }
      if (!found.length) return a.query ? `Nobody matches “${a.query}”.` : 'There are no people in Aster yet.'
      return [`Found: ${found.length}${found.length > limit ? `, first ${limit} shown` : ''}.`, ...found.slice(0, limit).map(p => line(p, c))].join('\n')
    },
  },
  {
    name: 'get_person',
    title: 'Person card',
    description: 'The full card: work, city, what they look for and how they can help, facts, topics to talk about, upcoming reminders and recent interactions.',
    readOnly: true,
    props: { person: { type: 'string', description: 'The name in words ("Oliver Stone") or an id.', maxLength: 120 } },
    required: ['person'],
    async run(a, c) {
      const all = await people(c)
      const p = resolvePerson(all, a.person)
      const [ints, rems] = await Promise.all([interactionsOf(c), remindersOf(c)])
      const mine = ints.filter(i => (i.personIds ?? []).includes(p.id)).sort((x, y) => y.date - x.date)
      const out: string[] = [`${fullName(p)}${p.nickname ? ` (“${p.nickname}”)` : ''} · id ${p.id}`]
      const add = (label: string, v: unknown) => { if (v) out.push(`${label}: ${v}`) }
      add('Work', [p.role, p.company].filter(Boolean).join(', '))
      add('City', p.city)
      add('Circle', CLOSENESS_NAME[p.closeness])
      add('Birthday', p.birthday)
      add('Met', [p.metAt, p.metPlace, p.metStory].filter(Boolean).join(' · '))
      add('Looking for', p.lookingFor); add('Can help me with', p.canHelpMe); add('I can help with', p.iCanHelp)
      add('Interests', (p.tags ?? []).join(', '))
      add('Contacts', (p.channels ?? []).map((x: any) => `${x.type}: ${x.value}`).join('; '))
      add('Facts', (p.facts ?? []).map((f: any) => f.text).join('; '))
      add('Ask about', (p.topics ?? []).filter((t: any) => !t.done).map((t: any) => t.text).join('; '))
      add('Notes', p.notes)
      add('Last contact', p.lastContactAt ? `${fmtDay(p.lastContactAt, c.tz)} (${relDays(daysBetweenDays(dayOf(c.now, c.tz), dayOf(p.lastContactAt, c.tz)))})` : 'none yet')
      const open = rems.filter(r => r.personId === p.id && !r.done).sort((x, y) => x.dueAt - y.dueAt)
      if (open.length) out.push('', 'Reminders:', ...open.slice(0, 8).map(r => `• ${r.text}, ${fmtWhen(r.dueAt, c.tz)} · id ${r.id}`))
      if (mine.length) out.push('', 'Recent interactions:', ...mine.slice(0, 8).map(i => `• ${fmtDay(i.date, c.tz)}: ${TYPE_LABEL[i.type] ?? i.type}${i.title ? `: ${i.title}` : ''}${i.note ? ` (${clip(i.note, 160)})` : ''}`))
      return out.join('\n')
    },
  },
  {
    name: 'add_person',
    title: 'Add a person',
    description: 'Creates a person card. First check with search_people that there is no such person yet: if the full name matches, the tool will not create a duplicate and will point to the existing one.',
    props: {
      first_name: { type: 'string', description: 'First name.', maxLength: 60 },
      last_name: { type: 'string', description: 'Last name.', maxLength: 60 },
      nickname: { type: 'string', description: 'What they are called.', maxLength: 60 },
      ...PERSON_FIELDS,
      allow_duplicate: { type: 'boolean', description: 'true: create even if a person with this name exists (a namesake).' },
    },
    required: ['first_name'],
    async run(a, c) {
      const all = await people(c)
      const name = [a.first_name, a.last_name].filter(Boolean).join(' ')
      const twin = all.find(p => !p.archived && lc(fullName(p)) === lc(name))
      if (twin && !a.allow_duplicate) throw new ToolError(`“${fullName(twin)}” already exists (id ${twin.id}). Add to that card with update_person or log_interaction. If this is a namesake, repeat with allow_duplicate=true.`)
      const p: any = { id: uuid(), createdAt: c.now, updatedAt: c.now, firstName: a.first_name, circleIds: [], tags: [], closeness: 3, channels: [], facts: [], topics: [], links: [] }
      if (a.last_name) p.lastName = a.last_name
      if (a.nickname) p.nickname = a.nickname
      applyFields(p, a, c)
      await c.store.put(c.uid, 'people', p.id, p)
      return `Added: ${fullName(p)} (${CLOSENESS_NAME[p.closeness]}) · id ${p.id}. The card will appear in the app within a few seconds.`
    },
  },
  {
    name: 'update_person',
    title: 'Update a card',
    description: 'Changes or extends a person card. Lists (interests, facts, topics, contacts) are added to the existing ones, notes are appended with a date. Single fields (company, city and so on) are replaced.',
    props: {
      person: { type: 'string', description: 'The name in words, or an id.', maxLength: 120 },
      first_name: { type: 'string', description: 'New first name.', maxLength: 60 },
      last_name: { type: 'string', description: 'New last name.', maxLength: 60 },
      nickname: { type: 'string', description: 'What they are called.', maxLength: 60 },
      ...PERSON_FIELDS,
    },
    required: ['person'],
    async run(a, c) {
      const all = await people(c)
      const p = { ...resolvePerson(all, a.person) }
      if (a.first_name) p.firstName = a.first_name
      if (a.last_name) p.lastName = a.last_name
      if (a.nickname) p.nickname = a.nickname
      applyFields(p, a, c)
      await c.store.put(c.uid, 'people', p.id, touch(c.now, p))
      const changed = Object.keys(a).filter(k => k !== 'person')
      return changed.length ? `Updated: ${fullName(p)} (${changed.join(', ')}).` : `Nothing to change for “${fullName(p)}”: no fields were given.`
    },
  },
  {
    name: 'log_interaction',
    title: 'Log a meeting or call',
    description: 'Records an interaction with one or more people: a meeting, call, messages, event, favor, gift or note. Updates "last contact" (except for notes), which the "time to reach out" reminders depend on.',
    props: {
      people: { type: 'array', description: 'With whom: names in words, or ids. At least one person.', items: { type: 'string', maxLength: 120 } },
      type: { type: 'string', description: 'Kind: meeting, call, message (messages), event, favor_given (I helped), favor_got (they helped me), gift, note (just a note, does not count as contact).', enum: ['meeting', 'call', 'message', 'event', 'favor_given', 'favor_got', 'gift', 'note'] },
      date: { type: 'string', description: 'When: YYYY-MM-DD or YYYY-MM-DDTHH:MM. Now if omitted.', maxLength: 30 },
      title: { type: 'string', description: 'A few words on what it was about: "Coffee about the launch".', maxLength: 120 },
      note: { type: 'string', description: 'Details: what was discussed and agreed.', maxLength: 3000 },
      place: { type: 'string', description: 'Where.', maxLength: 120 },
      initiator: { type: 'string', description: 'Who started the contact: me, them, or both.', enum: ['me', 'them', 'both'] },
    },
    required: ['people', 'type'],
    async run(a, c) {
      const all = await people(c)
      const found: any[] = []
      for (const ref of a.people as string[]) {
        const p = resolvePerson(all, ref)
        if (!found.some(x => x.id === p.id)) found.push(p)
      }
      if (!found.length) throw new ToolError('At least one person is required.')
      const when = a.date ? parseWhen(a.date, c.tz, 12) : { ms: c.now, dateOnly: false, day: dayOf(c.now, c.tz) }
      if (when.ms > c.now + 24 * 3_600_000) throw new ToolError('The interaction date is in the future. Use add_reminder for future things.')
      const it: any = { id: uuid(), personIds: found.map(p => p.id), type: a.type, date: when.ms, createdAt: c.now }
      if (a.title) it.title = a.title
      if (a.note) it.note = a.note
      if (a.place) it.place = a.place
      if (a.initiator) it.initiator = a.initiator
      await c.store.put(c.uid, 'interactions', it.id, it)
      if (CONTACT_TYPES.includes(a.type)) {
        for (const p of found) await c.store.put(c.uid, 'people', p.id, touch(c.now, { ...p, lastContactAt: Math.max(p.lastContactAt ?? 0, when.ms), snoozedUntil: undefined }))
      }
      return `Logged: ${TYPE_LABEL[a.type]} with ${found.map(fullName).join(', ')}, ${fmtDay(when.ms, c.tz)}${a.title ? `, “${a.title}”` : ''}. id ${it.id}`
    },
  },
  {
    name: 'list_interactions',
    title: 'Interaction history',
    description: 'Recorded interactions (meetings, calls and so on) over the last days, for one person or for everyone.',
    readOnly: true,
    props: {
      person: { type: 'string', description: 'The name in words, or an id. Everyone if omitted.', maxLength: 120 },
      days: { type: 'integer', description: 'Over how many recent days (default 30).', minimum: 1, maximum: 3650 },
      limit: { type: 'integer', description: 'How many records (default 20, at most 100).', minimum: 1, maximum: 100 },
    },
    async run(a, c) {
      const all = await people(c)
      const p = a.person ? resolvePerson(all, a.person) : null
      const names = new Map(all.map(x => [x.id, fullName(x)]))
      const since = c.now - (a.days ?? 30) * 86_400_000
      const rows = (await interactionsOf(c)).filter(i => i.date >= since && (!p || (i.personIds ?? []).includes(p.id))).sort((x, y) => y.date - x.date)
      if (!rows.length) return p ? `No interactions with “${fullName(p)}” in this period.` : 'No interactions in this period.'
      const limit = a.limit ?? 20
      return [`Records: ${rows.length}${rows.length > limit ? `, first ${limit} shown` : ''}.`, ...rows.slice(0, limit).map(i => `• ${fmtDay(i.date, c.tz)}: ${TYPE_LABEL[i.type] ?? i.type} with ${(i.personIds ?? []).map((id: string) => names.get(id) ?? '?').join(', ')}${i.title ? `: ${i.title}` : ''}${i.note ? ` (${clip(i.note, 200)})` : ''}`)].join('\n')
    },
  },
  {
    name: 'add_reminder',
    title: 'Set a reminder',
    description: 'A reminder for a date and time: to write to someone, call back, not forget an agreement. Can be tied to a person. If only a date is given, it reminds at 9:00.',
    props: {
      text: { type: 'string', description: 'What to remind about, briefly: "Write about the contract".', maxLength: 300 },
      when: { type: 'string', description: 'When: YYYY-MM-DD or YYYY-MM-DDTHH:MM by the owner\'s clock.', maxLength: 30 },
      person: { type: 'string', description: 'About whom (name in words, or an id), optional.', maxLength: 120 },
    },
    required: ['text', 'when'],
    async run(a, c) {
      const w = parseWhen(a.when, c.tz, 9)
      const p = a.person ? resolvePerson(await people(c), a.person) : null
      const r: any = { id: uuid(), text: a.text, dueAt: w.ms, done: false, createdAt: c.now, updatedAt: c.now }
      if (p) r.personId = p.id
      await c.store.put(c.uid, 'reminders', r.id, r)
      return `Reminder set: “${a.text}”${p ? ` (${fullName(p)})` : ''}, ${fmtWhen(w.ms, c.tz)}. id ${r.id}`
    },
  },
  {
    name: 'list_reminders',
    title: 'Reminders',
    description: 'A list of reminders: open (default), done or all. Can be limited to one person.',
    readOnly: true,
    props: {
      status: { type: 'string', description: 'open, done or all.', enum: ['open', 'done', 'all'] },
      person: { type: 'string', description: 'The name in words, or an id.', maxLength: 120 },
      limit: { type: 'integer', description: 'How many (default 25, at most 100).', minimum: 1, maximum: 100 },
    },
    async run(a, c) {
      const all = await people(c)
      const p = a.person ? resolvePerson(all, a.person) : null
      const names = new Map(all.map(x => [x.id, fullName(x)]))
      const st = a.status ?? 'open'
      const rows = (await remindersOf(c)).filter(r => (st === 'all' || (st === 'done') === !!r.done) && (!p || r.personId === p.id)).sort((x, y) => (st === 'done' ? (y.doneAt ?? 0) - (x.doneAt ?? 0) : x.dueAt - y.dueAt))
      if (!rows.length) return st === 'done' ? 'No completed reminders.' : 'No open reminders.'
      const limit = a.limit ?? 25
      return [`Reminders: ${rows.length}${rows.length > limit ? `, first ${limit} shown` : ''}.`, ...rows.slice(0, limit).map(r => `• ${r.done ? '✓ ' : ''}${r.text}${r.personId && names.get(r.personId) ? ` (${names.get(r.personId)})` : ''}, ${fmtWhen(r.dueAt, c.tz)} · id ${r.id}`)].join('\n')
    },
  },
  {
    name: 'complete_reminder',
    title: 'Complete a reminder',
    description: 'Marks a reminder done (or reopens it with undo=true). Take the id from list_reminders or today_overview.',
    props: {
      id: { type: 'string', description: 'The reminder id.', maxLength: 80 },
      undo: { type: 'boolean', description: 'true: reopen it.' },
    },
    required: ['id'],
    async run(a, c) {
      const r = (await remindersOf(c)).find(x => x.id === a.id)
      if (!r) throw new ToolError('No such reminder. Look up the id with list_reminders.')
      const next = a.undo ? { ...r, done: false, doneAt: undefined } : { ...r, done: true, doneAt: c.now }
      await c.store.put(c.uid, 'reminders', r.id, touch(c.now, next))
      return a.undo ? `Reopened: “${r.text}”.` : `Done: “${r.text}”.`
    },
  },
  {
    name: 'update_reminder',
    title: 'Edit a reminder',
    description: 'Changes the text or time of a reminder (for example, moves it to another day).',
    props: {
      id: { type: 'string', description: 'The reminder id.', maxLength: 80 },
      text: { type: 'string', description: 'New text.', maxLength: 300 },
      when: { type: 'string', description: 'New time: YYYY-MM-DD or YYYY-MM-DDTHH:MM.', maxLength: 30 },
    },
    required: ['id'],
    async run(a, c) {
      const r = (await remindersOf(c)).find(x => x.id === a.id)
      if (!r) throw new ToolError('No such reminder. Look up the id with list_reminders.')
      const next = { ...r }
      if (a.text) next.text = a.text
      if (a.when) next.dueAt = parseWhen(a.when, c.tz, 9).ms
      if (!a.text && !a.when) throw new ToolError('Give a new text or time.')
      await c.store.put(c.uid, 'reminders', r.id, touch(c.now, next))
      return `Updated: “${next.text}”, ${fmtWhen(next.dueAt, c.tz)}.`
    },
  },
]
