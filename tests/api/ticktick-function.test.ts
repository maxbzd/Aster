// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handle, parseSync, readState, safeReturn, signState, startOfZonedDay, taskBody, ttDate, type Db, type Env, type LinkRow, type TokenRow } from '../../supabase/functions/ticktick/handler'

const SITE = 'https://aster.example.workers.dev'
const BASE = 'https://proj.supabase.co/functions/v1/ticktick'
const env = (over: Partial<Env> = {}): Env => ({
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_x', SUPABASE_SERVICE_ROLE_KEY: 'srv',
  TICKTICK_CLIENT_ID: 'cid', TICKTICK_CLIENT_SECRET: 'csecret', ALLOWED_EMAILS: 'Owner@Mail.com', ALLOWED_ORIGINS: SITE, ...over,
})

let seq = 0
const tok = () => `t${++seq}.abc-def`
const owner = { id: 'u1', email: 'owner@mail.com', email_confirmed_at: '2026-01-01T00:00:00Z' }

class MemDb implements Db {
  token: TokenRow | null = null
  links = new Map<string, LinkRow>()
  async getToken() { return this.token }
  async putToken(r: TokenRow) { this.token = r }
  async deleteToken() { this.token = null }
  async getLinks(uid: string) { return [...this.links.values()].filter(l => l.user_id === uid) }
  async claimLink(uid: string, key: string) {
    if (this.links.has(key)) return false
    this.links.set(key, { user_id: uid, key, task_id: 'pending', project_id: '', completed: false, gone: false })
    return true
  }
  async setLink(_uid: string, key: string, patch: Partial<LinkRow>) { Object.assign(this.links.get(key)!, patch) }
  async dropLink(_uid: string, key: string) { if (this.links.get(key)?.task_id === 'pending') this.links.delete(key) }
}

interface Call { url: string; method: string; body?: string; auth?: string }

/** Supabase answers about the user; TickTick follows a scenario. */
function mockWorld(opts: { user?: typeof owner | null; tt?: (c: Call) => Response | undefined } = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const c: Call = { url: u, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : undefined, auth: (init?.headers as Record<string, string> | undefined)?.authorization }
    calls.push(c)
    if (u.includes('/auth/v1/user')) return opts.user === null ? new Response('{}', { status: 401 }) : new Response(JSON.stringify(opts.user ?? owner), { status: 200 })
    return opts.tt?.(c) ?? new Response('{}', { status: 404 })
  }))
  return calls
}

const req = (path: string, init: RequestInit & { token?: string } = {}) => {
  const { token, ...rest } = init
  return new Request(`${BASE}${path}`, { ...rest, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...(rest.headers as Record<string, string>) } })
}
const post = (path: string, body: unknown, token = tok()) => req(path, { method: 'POST', body: JSON.stringify(body), token })
const json = async (r: Response) => (await r.json()) as Record<string, unknown>

afterEach(() => vi.unstubAllGlobals())

describe('time', () => {
  it('TickTick\'s date format', () => {
    expect(ttDate(new Date('2026-10-12T07:30:00.000Z'))).toBe('2026-10-12T07:30:00+0000')
  })
  it('the start of a local day in a time zone', () => {
    expect(startOfZonedDay('2026-10-12', 'Europe/Moscow').toISOString()).toBe('2026-10-11T21:00:00.000Z')
    expect(startOfZonedDay('2026-10-12', 'America/New_York').toISOString()).toBe('2026-10-12T04:00:00.000Z')
    expect(startOfZonedDay('2026-10-12', 'UTC').toISOString()).toBe('2026-10-12T00:00:00.000Z')
  })
  it('the task body: a due moment and a whole day, priority', () => {
    expect(taskBody({ key: 'orbita:item:1', title: 'Позвонить', dueAt: '2026-10-12T07:30:00Z', priority: 'high' }, 'Europe/Moscow'))
      .toMatchObject({ title: 'Позвонить', dueDate: '2026-10-12T07:30:00+0000', isAllDay: false, priority: 5, timeZone: 'Europe/Moscow' })
    expect(taskBody({ key: 'orbita:item:1', title: 'Оплатить', dueDay: '2026-10-12' }, 'Europe/Moscow'))
      .toMatchObject({ dueDate: '2026-10-11T21:00:00+0000', isAllDay: true })
    expect(taskBody({ key: 'aster:reminder:1', title: 'Без срока' }, 'UTC')).not.toHaveProperty('dueDate')
  })
})

describe('parsing the request', () => {
  it('accepts normal records and drops garbage', () => {
    expect(parseSync({ open: [{ key: 'aster:reminder:r1', title: '  Написать Олегу ', notes: 'про договор', dueAt: '2026-10-12T07:00:00Z' }], done: ['aster:reminder:r0'], tz: 'Europe/Moscow' }))
      .toEqual({ open: [{ key: 'aster:reminder:r1', title: 'Написать Олегу', notes: 'про договор', dueAt: '2026-10-12T07:00:00Z' }], done: ['aster:reminder:r0'], tz: 'Europe/Moscow' })
    expect(parseSync({ open: [{ key: 'bad key', title: 'x' }], done: [] })).toBe('Invalid record key')
    expect(parseSync({ open: [{ key: 'aster:reminder:1', title: '  ' }], done: [] })).toBe('The record has no title')
    expect(parseSync({ open: [], done: [], tz: '../../etc' })).toMatchObject({ tz: 'UTC' })
    expect(parseSync(null)).toBe('A JSON object is required')
  })
})

describe('sign-in and access', () => {
  it('no session: 401, a foreign email: 403, a foreign site: 403', async () => {
    mockWorld({ user: null })
    expect((await handle(req('/status'), env(), { db: new MemDb() })).status).toBe(401)
    mockWorld({ user: { ...owner, email: 'stranger@mail.com' } })
    expect((await handle(req('/status', { token: tok() }), env(), { db: new MemDb() })).status).toBe(403)
    mockWorld()
    expect((await handle(req('/status', { token: tok(), headers: { origin: 'https://evil.example' } }), env(), { db: new MemDb() })).status).toBe(403)
  })

  it('status: not configured, not connected, connected', async () => {
    mockWorld()
    const db = new MemDb()
    expect(await json(await handle(req('/status', { token: tok() }), env({ TICKTICK_CLIENT_ID: undefined }), { db }))).toMatchObject({ configured: false, connected: false })
    expect(await json(await handle(req('/status', { token: tok() }), env(), { db }))).toMatchObject({ configured: true, connected: false })
    db.token = { user_id: 'u1', access_token: 'a', expires_at: new Date(Date.now() + 1e9).toISOString() }
    expect(await json(await handle(req('/status', { token: tok() }), env(), { db }))).toMatchObject({ connected: true })
    db.token = { user_id: 'u1', access_token: 'a', expires_at: new Date(Date.now() - 1000).toISOString() }
    expect(await json(await handle(req('/status', { token: tok() }), env(), { db }))).toMatchObject({ connected: false })
  })
})

describe('connecting', () => {
  it('the consent link contains the app id, the scope and a signed state; the return address is checked', async () => {
    mockWorld()
    const r = await handle(post('/connect', { returnTo: `${SITE}/#/me` }), env(), { db: new MemDb() })
    const { url } = (await json(r)) as { url: string }
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://ticktick.com/oauth/authorize')
    expect(u.searchParams.get('client_id')).toBe('cid')
    expect(u.searchParams.get('scope')).toBe('tasks:write tasks:read')
    expect(u.searchParams.get('redirect_uri')).toBe(`${BASE}/callback`)
    expect(u.searchParams.get('response_type')).toBe('code')
    const st = await readState(u.searchParams.get('state')!, 'csecret')
    expect(st).toMatchObject({ uid: 'u1', ret: `${SITE}/#/me` })

    expect((await handle(post('/connect', { returnTo: 'https://evil.example/' }), env(), { db: new MemDb() })).status).toBe(400)
  })

  it('state cannot be forged and lives for ten minutes', async () => {
    const s = await signState({ uid: 'u1', exp: Date.now() + 1000, ret: SITE }, 'csecret')
    expect(await readState(s, 'csecret')).not.toBeNull()
    expect(await readState(s, 'other')).toBeNull()
    expect(await readState(s.replace(/^./, 'x'), 'csecret')).toBeNull()
    expect(await readState(s, 'csecret', Date.now() + 5000)).toBeNull()
    expect(safeReturn('javascript:alert(1)', env())).toBeNull()
  })

  it('the return from TickTick: exchanges the code for a token, saves it and returns the person to the app', async () => {
    const calls = mockWorld({ tt: c => (c.url === 'https://ticktick.com/oauth/token' ? new Response(JSON.stringify({ access_token: 'AT', expires_in: 1000 }), { status: 200 }) : undefined) })
    const db = new MemDb()
    const state = await signState({ uid: 'u1', exp: Date.now() + 60_000, ret: `${SITE}/#/me` }, 'csecret')
    const r = await handle(new Request(`${BASE}/callback?code=CODE&state=${state}`), env(), { db })
    expect(r.status).toBe(302)
    const to = new URL(r.headers.get('location')!)
    expect(to.origin).toBe(SITE)
    expect(to.searchParams.get('ticktick')).toBe('ok')
    expect(to.hash).toBe('#/me')
    expect(db.token).toMatchObject({ user_id: 'u1', access_token: 'AT' })
    const t = calls.find(c => c.url.includes('/oauth/token'))!
    expect(t.auth).toBe(`Basic ${btoa('cid:csecret')}`)
    expect(t.body).toContain('grant_type=authorization_code')
    expect(t.body).toContain('code=CODE')
  })

  it('a return with a foreign state or without consent saves nothing', async () => {
    mockWorld({ tt: () => new Response(JSON.stringify({ access_token: 'AT' }), { status: 200 }) })
    const db = new MemDb()
    expect((await handle(new Request(`${BASE}/callback?code=C&state=bad.state`), env(), { db })).status).toBe(400)
    const state = await signState({ uid: 'u1', exp: Date.now() + 60_000, ret: SITE }, 'csecret')
    const denied = await handle(new Request(`${BASE}/callback?error=access_denied&state=${state}`), env(), { db })
    expect(new URL(denied.headers.get('location')!).searchParams.get('ticktick')).toBe('denied')
    expect(db.token).toBeNull()
  })

  it('disconnecting erases the token', async () => {
    mockWorld()
    const db = new MemDb()
    db.token = { user_id: 'u1', access_token: 'a' }
    await handle(post('/disconnect', {}), env(), { db })
    expect(db.token).toBeNull()
  })
})

describe('sync', () => {
  const connected = () => { const db = new MemDb(); db.token = { user_id: 'u1', access_token: 'AT', expires_at: new Date(Date.now() + 1e9).toISOString() }; return db }
  const tasks = (list: Array<{ id: string; projectId?: string }>) => (c: Call) => {
    if (c.method === 'POST' && c.url.endsWith('/open/v1/task')) return new Response(JSON.stringify({ id: `tt-${JSON.parse(c.body!).title}`, projectId: 'inbox1' }), { status: 200 })
    if (c.url.endsWith('/project/inbox1/data')) return new Response(JSON.stringify({ tasks: list }), { status: 200 })
    return undefined
  }

  it('without a connection: 409 not_connected', async () => {
    mockWorld()
    const r = await handle(post('/sync', { open: [], done: [] }), env(), { db: new MemDb() })
    expect(r.status).toBe(409)
    expect(await json(r)).toMatchObject({ error: 'not_connected' })
  })

  it('a new record becomes a TickTick task once; a repeated request does not duplicate it', async () => {
    const calls = mockWorld({ tt: tasks([{ id: 'tt-Позвонить' }]) })
    const db = connected()
    const body = { open: [{ key: 'orbita:item:i1', title: 'Позвонить', dueAt: '2026-10-12T07:00:00Z' }], done: [], tz: 'Europe/Moscow' }
    expect(await json(await handle(post('/sync', body), env(), { db }))).toMatchObject({ created: 1, completed: [] })
    expect(db.links.get('orbita:item:i1')).toMatchObject({ task_id: 'tt-Позвонить', project_id: 'inbox1', completed: false })
    const create = calls.find(c => c.url.endsWith('/open/v1/task'))!
    expect(create.auth).toBe('Bearer AT')
    expect(JSON.parse(create.body!)).toMatchObject({ title: 'Позвонить', dueDate: '2026-10-12T07:00:00+0000' })

    expect(await json(await handle(post('/sync', body), env(), { db }))).toMatchObject({ created: 0 })
    expect(calls.filter(c => c.url.endsWith('/open/v1/task')).length).toBe(1)
  })

  it('two devices at once: the task is created once', async () => {
    const calls = mockWorld({ tt: tasks([]) })
    const db = connected()
    const body = { open: [{ key: 'aster:reminder:r1', title: 'Написать' }], done: [] }
    await Promise.all([handle(post('/sync', body), env(), { db }), handle(post('/sync', body), env(), { db })])
    expect(calls.filter(c => c.url.endsWith('/open/v1/task')).length).toBe(1)
  })

  it('done in the app: closed in TickTick, not closed a second time', async () => {
    const calls = mockWorld({ tt: c => (c.url.endsWith('/complete') ? new Response('', { status: 200 }) : tasks([])(c)) })
    const db = connected()
    db.links.set('aster:reminder:r1', { user_id: 'u1', key: 'aster:reminder:r1', task_id: 'T1', project_id: 'inbox1', completed: false, gone: false })
    const r1 = await json(await handle(post('/sync', { open: [], done: ['aster:reminder:r1'] }), env(), { db }))
    expect(r1).toMatchObject({ closed: 1 })
    expect(calls.find(c => c.url.endsWith('/project/inbox1/task/T1/complete'))?.method).toBe('POST')
    expect(db.links.get('aster:reminder:r1')?.completed).toBe(true)
    const r2 = await json(await handle(post('/sync', { open: [], done: ['aster:reminder:r1'] }), env(), { db }))
    expect(r2).toMatchObject({ closed: 0 })
  })

  it('done in TickTick: the app is told the record key', async () => {
    mockWorld({
      tt: c => {
        if (c.url.endsWith('/project/inbox1/data')) return new Response(JSON.stringify({ tasks: [{ id: 'T2' }] }), { status: 200 })
        if (c.url.endsWith('/project/inbox1/task/T1')) return new Response(JSON.stringify({ id: 'T1', status: 2 }), { status: 200 })
        return undefined
      },
    })
    const db = connected()
    for (const [k, id] of [['orbita:item:a', 'T1'], ['orbita:item:b', 'T2']] as const) db.links.set(k, { user_id: 'u1', key: k, task_id: id, project_id: 'inbox1', completed: false, gone: false })
    const r = await json(await handle(post('/sync', { open: [{ key: 'orbita:item:a', title: 'A' }, { key: 'orbita:item:b', title: 'B' }], done: [] }), env(), { db }))
    expect(r.completed).toEqual(['orbita:item:a'])
    expect(db.links.get('orbita:item:a')?.completed).toBe(true)
    expect(db.links.get('orbita:item:b')?.completed).toBe(false)
    // the app did not manage to apply it: the next request will remind it
    const again = await json(await handle(post('/sync', { open: [{ key: 'orbita:item:a', title: 'A' }], done: [] }), env(), { db }))
    expect(again.completed).toEqual(['orbita:item:a'])
  })

  it('a task deleted in TickTick: the link is marked and no longer polled', async () => {
    const calls = mockWorld({
      tt: c => {
        if (c.url.endsWith('/project/inbox1/data')) return new Response(JSON.stringify({ tasks: [] }), { status: 200 })
        if (c.url.endsWith('/task/T9')) return new Response('not found', { status: 404 })
        return undefined
      },
    })
    const db = connected()
    db.links.set('aster:reminder:x', { user_id: 'u1', key: 'aster:reminder:x', task_id: 'T9', project_id: 'inbox1', completed: false, gone: false })
    expect((await json(await handle(post('/sync', { open: [{ key: 'aster:reminder:x', title: 'X' }], done: [] }), env(), { db }))).completed).toEqual([])
    expect(db.links.get('aster:reminder:x')?.gone).toBe(true)
    const before = calls.length
    await handle(post('/sync', { open: [{ key: 'aster:reminder:x', title: 'X' }], done: [] }), env(), { db })
    expect(calls.slice(before).filter(c => c.url.includes('api.ticktick.com')).length).toBe(0)
  })

  it('a creation failure releases the key so that the attempt repeats', async () => {
    mockWorld({ tt: c => (c.url.endsWith('/open/v1/task') ? new Response('boom', { status: 500 }) : undefined) })
    const db = connected()
    const r = await json(await handle(post('/sync', { open: [{ key: 'aster:reminder:r1', title: 'Написать' }], done: [] }), env(), { db }))
    expect(r.created).toBe(0)
    expect((r.errors as string[]).length).toBe(1)
    expect(db.links.size).toBe(0)
  })

  it('the token is rejected by TickTick: the token is erased, the app is told expired', async () => {
    mockWorld({ tt: c => (c.url.endsWith('/open/v1/task') ? new Response('unauthorized', { status: 401 }) : undefined) })
    const db = connected()
    const r = await handle(post('/sync', { open: [{ key: 'aster:reminder:r1', title: 'Написать' }], done: [] }), env(), { db })
    expect(r.status).toBe(409)
    expect(await json(r)).toMatchObject({ error: 'expired' })
    expect(db.token).toBeNull()
  })

  it('an expired token without a refresh_token: expired; with a refresh_token: refreshed', async () => {
    mockWorld()
    const db = new MemDb()
    db.token = { user_id: 'u1', access_token: 'old', expires_at: new Date(Date.now() - 1000).toISOString() }
    expect(await json(await handle(post('/sync', { open: [], done: [] }), env(), { db }))).toMatchObject({ error: 'expired' })

    const calls = mockWorld({ tt: c => (c.url.endsWith('/oauth/token') ? new Response(JSON.stringify({ access_token: 'NEW', expires_in: 5000 }), { status: 200 }) : undefined) })
    db.token = { user_id: 'u1', access_token: 'old', refresh_token: 'RT', expires_at: new Date(Date.now() - 1000).toISOString() }
    expect((await handle(post('/sync', { open: [], done: [] }), env(), { db })).status).toBe(200)
    expect(db.token).toMatchObject({ access_token: 'NEW', refresh_token: 'RT' })
    expect(calls.find(c => c.url.endsWith('/oauth/token'))?.body).toContain('grant_type=refresh_token')
  })
})
