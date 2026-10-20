// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { handle, nameMatches, parseWhen, TOOLS as TOOLS_FOR_TEST, validate, type Deps, type Env, type Row, type Store, type Tokens } from '../../supabase/functions/mcp/handler'

const URL_BASE = 'https://proj.supabase.co/functions/v1/mcp'
const TOKEN = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const NOW = new Date('2026-10-12T09:30:00Z').getTime() // a Monday, 12:30 in Moscow
const env: Env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', ALLOWED_EMAILS: 'Owner@Mail.com', MCP_TIMEZONE: 'Europe/Moscow' }

class MemStore implements Store {
  rows = new Map<string, Row>()
  async list(uid: string, tbl: string) { return [...this.rows.entries()].filter(([k]) => k.startsWith(`${uid}|${tbl}|`)).map(([, v]) => structuredClone(v)) }
  async put(uid: string, tbl: string, id: string, data: Record<string, any>) { this.rows.set(`${uid}|${tbl}|${id}`, { id, data: structuredClone(data) }) }
  all(tbl: string) { return [...this.rows.entries()].filter(([k]) => k.includes(`|${tbl}|`)).map(([, v]) => v.data) }
}

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')

let worlds = 0
async function world(over: { email?: string | null } = {}) {
  const store = new MemStore()
  const n = ++worlds
  const valid = new Map([[await sha(TOKEN), { id: `tok1-${n}`, user_id: `u1-${n}` }], [await sha(OTHER), { id: `tok2-${n}`, user_id: `u2-${n}` }]])
  const tokens: Tokens = {
    async find(h) { return valid.get(h) ?? null },
    async touch() {},
    async email(uid) { return uid.startsWith('u1') ? (over.email === undefined ? 'owner@mail.com' : over.email) : 'stranger@mail.com' },
  }
  const deps: Deps = { store, tokens, now: NOW }
  const rpc = async (method: string, params?: unknown, id: number | null = 1, token = TOKEN) => {
    const res = await handle(new Request(`${URL_BASE}/${token}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), headers: { 'content-type': 'application/json' } }), env, deps)
    return { status: res.status, body: res.status === 202 ? null : ((await res.json()) as any) }
  }
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const { body } = await rpc('tools/call', { name, arguments: args })
    return { text: body.result.content[0].text as string, error: !!body.result.isError }
  }
  return { store, deps, rpc, call }
}

describe('MCP protocol', () => {
  it('initialize: negotiates the version and introduces itself', async () => {
    const { rpc } = await world()
    const r = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude', version: '1' } })
    expect(r.body.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'aster' } })
    expect(r.body.result.instructions).toContain('Aster')
    expect((await rpc('initialize', { protocolVersion: '1999-01-01' })).body.result.protocolVersion).toBe('2025-06-18')
  })

  it('notifications get 202 with no body, ping an empty result, an unknown method an error', async () => {
    const { rpc } = await world()
    const res = await handle(new Request(`${URL_BASE}/${TOKEN}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), env, (await world()).deps)
    expect(res.status).toBe(202)
    expect((await rpc('ping')).body.result).toEqual({})
    expect((await rpc('nope')).body.error.code).toBe(-32601)
  })

  it('a batch of requests is handled as a whole', async () => {
    const { deps } = await world()
    const res = await handle(new Request(`${URL_BASE}/${TOKEN}`, { method: 'POST', body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]) }), env, deps)
    const body = (await res.json()) as any[]
    expect(body.map(x => x.id)).toEqual([1, 2])
  })

  it('tools/list: every tool has a name, a description and a valid schema', async () => {
    const { rpc } = await world()
    const { tools } = (await rpc('tools/list')).body.result
    expect(tools.length).toBeGreaterThanOrEqual(12)
    expect(new Set(tools.map((t: any) => t.name)).size).toBe(tools.length)
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z_]+$/)
      expect(t.description.length).toBeGreaterThan(20)
      expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      for (const [k, p] of Object.entries<any>(t.inputSchema.properties)) {
        expect(p.description, `${t.name}.${k}`).toBeTruthy()
        expect(['string', 'number', 'integer', 'boolean', 'array']).toContain(p.type)
      }
      for (const r of t.inputSchema.required) expect(t.inputSchema.properties).toHaveProperty(r)
    }
    expect(tools.find((t: any) => t.name === 'search_people').annotations.readOnlyHint).toBe(true)
    expect(tools.find((t: any) => t.name === 'add_person').annotations.readOnlyHint).toBe(false)
  })

  it('not JSON: 400, GET: 405, too large a request: 413', async () => {
    const { deps } = await world()
    expect((await handle(new Request(`${URL_BASE}/${TOKEN}`, { method: 'POST', body: '{oops' }), env, deps)).status).toBe(400)
    expect((await handle(new Request(`${URL_BASE}/${TOKEN}`, { method: 'GET' }), env, deps)).status).toBe(405)
    expect((await handle(new Request(`${URL_BASE}/${TOKEN}`, { method: 'POST', body: 'x'.repeat(250_000) }), env, deps)).status).toBe(413)
    expect((await handle(new Request(`${URL_BASE}/${TOKEN}`, { method: 'OPTIONS' }), env, deps)).status).toBe(204)
  })
})

describe('access', () => {
  const post = (url: string, headers: Record<string, string> = {}) => new Request(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), headers })

  it('no key, a malformed key and an unknown key: 401', async () => {
    const { deps } = await world()
    expect((await handle(post(URL_BASE), env, deps)).status).toBe(401)
    expect((await handle(post(`${URL_BASE}/short`), env, deps)).status).toBe(401)
    expect((await handle(post(`${URL_BASE}/${'c'.repeat(64)}`), env, deps)).status).toBe(401)
  })

  it('the key works both in the address and in the Authorization header', async () => {
    const { deps } = await world()
    expect((await handle(post(`${URL_BASE}/${TOKEN}`), env, deps)).status).toBe(200)
    expect((await handle(post(URL_BASE, { authorization: `Bearer ${TOKEN}` }), env, deps)).status).toBe(200)
    expect((await handle(post(`${URL_BASE}/${TOKEN.toUpperCase()}`), env, deps)).status).toBe(200)
  })

  it('an email not on the owners list: 403', async () => {
    const { deps } = await world()
    expect((await handle(post(`${URL_BASE}/${OTHER}`), env, deps)).status).toBe(403)
    const { deps: d2 } = await world({ email: null })
    expect((await handle(post(`${URL_BASE}/${TOKEN}`), { ...env, ALLOWED_EMAILS: 'someone@else.com' }, { ...d2, now: NOW + 10 * 60_000 })).status).toBe(403)
  })

  it('rate limit: at most 120 requests a minute per key', async () => {
    const { deps } = await world()
    const tokens: Tokens = { ...deps.tokens!, async find(h) { return h === (await sha(TOKEN)) ? { id: 'burst', user_id: 'u1-burst' } : null }, async email() { return 'owner@mail.com' } }
    let last = 200
    for (let i = 0; i < 125; i++) last = (await handle(post(`${URL_BASE}/${TOKEN}`), env, { ...deps, tokens })).status
    expect(last).toBe(429)
  })
})

describe('argument and date validation', () => {
  it('coerces types and rejects what is wrong', () => {
    const tool = TOOLS_FOR_TEST.find(t => t.name === 'add_person')!
    expect(validate(tool, { first_name: ' Олег ', closeness: '2', tags: 'ai', allow_duplicate: 'true' })).toEqual({ first_name: 'Олег', closeness: 2, tags: ['ai'], allow_duplicate: true })
    expect(() => validate(tool, {})).toThrow('first_name')
    expect(() => validate(tool, { first_name: 'О', closeness: 7 })).toThrow('at most 4')
    expect(() => validate(tool, { first_name: 'О', channels: [{ type: 'fax', value: '1' }] })).toThrow('accepts only')
  })

  it('parseWhen: a date, a date with time by the owner\'s clock, ISO with an offset, garbage', () => {
    expect(new Date(parseWhen('2026-10-15', 'Europe/Moscow').ms).toISOString()).toBe('2026-10-15T06:00:00.000Z')
    expect(new Date(parseWhen('2026-10-15T18:30', 'Europe/Moscow').ms).toISOString()).toBe('2026-10-15T15:30:00.000Z')
    expect(new Date(parseWhen('2026-10-15T18:30:00+03:00', 'UTC').ms).toISOString()).toBe('2026-10-15T15:30:00.000Z')
    expect(parseWhen('2026-10-15T23:30', 'Europe/Moscow').day).toBe('2026-10-15')
    expect(() => parseWhen('завтра', 'UTC')).toThrow('Could not understand the date')
    expect(() => parseWhen('2026-02-31', 'UTC')).toThrow('There is no such date')
  })

  it('names are found by the start of a word, in any Russian case form', () => {
    expect(nameMatches('Олегу', 'Олег Иванов')).toBe(true)
    expect(nameMatches('Ив', 'Олег Иванов')).toBe(true)
    expect(nameMatches('Иванов Олег', 'Олег Иванов')).toBe(true)
    expect(nameMatches('Пётр', 'Олег Иванов')).toBe(false)
  })
})

describe('Aster tools', () => {
  it('person → interaction → search → reminder → overview → done', async () => {
    const { call, store } = await world()
    const added = await call('add_person', { first_name: 'Олег', last_name: 'Иванов', company: 'Рокет', role: 'CTO', city: 'Дубай', closeness: 2, looking_for: 'инвестора в раунд', facts: ['двое детей'], channels: [{ type: 'telegram', value: '@oleg' }], birthday: '1985-10-20' })
    expect(added.error).toBe(false)
    expect(added.text).toContain('Олег Иванов')
    const person = store.all('people')[0]!
    expect(person).toMatchObject({ firstName: 'Олег', lastName: 'Иванов', closeness: 2, company: 'Рокет', circleIds: [], links: [] })
    expect(person.facts).toEqual([{ icon: 'sparkle', text: 'двое детей' }])
    expect(person.channels).toEqual([{ type: 'telegram', value: '@oleg' }])

    const dup = await call('add_person', { first_name: 'Олег', last_name: 'Иванов' })
    expect(dup.error).toBe(true)
    expect(dup.text).toContain('already exists')
    expect((await call('add_person', { first_name: 'Олег', last_name: 'Иванов', allow_duplicate: true })).error).toBe(false)
    store.rows.delete([...store.rows.keys()].find(k => k.includes('|people|') && !k.endsWith(`|${person.id}`))!)

    const found = await call('search_people', { query: 'дубай' })
    expect(found.text).toContain('Олег Иванов')
    expect((await call('search_people', { query: 'ищет инвестор' })).text).toContain('Олег Иванов')
    expect((await call('search_people', { query: 'Олегу' })).text).toContain('Олег Иванов')
    expect((await call('search_people', { query: 'Марс' })).text).toContain('Nobody matches')

    const logged = await call('log_interaction', { people: ['Олегом Ивановым'], type: 'meeting', date: '2026-10-10T19:00', title: 'Кофе про раунд', note: 'Договорились про интро' })
    expect(logged.error).toBe(false)
    const inter = store.all('interactions')[0]!
    expect(inter).toMatchObject({ personIds: [person.id], type: 'meeting', title: 'Кофе про раунд' })
    expect(inter.date).toBe(new Date('2026-10-10T16:00:00Z').getTime())
    expect(store.all('people').find(p => p.id === person.id)!.lastContactAt).toBe(inter.date)

    const rem = await call('add_reminder', { text: 'Написать про интро', when: '2026-10-12', person: 'Олег' })
    expect(rem.text).toContain('09:00')
    const id = store.all('reminders')[0]!.id
    expect(store.all('reminders')[0]).toMatchObject({ personId: person.id, done: false, dueAt: new Date('2026-10-12T06:00:00Z').getTime() })

    const overview = await call('today_overview')
    expect(overview.text).toContain('Написать про интро')
    expect(overview.text).toContain('Олег Иванов')
    expect(overview.text).toContain('birthday')

    expect((await call('complete_reminder', { id })).text).toContain('Done')
    expect(store.all('reminders')[0]).toMatchObject({ done: true, doneAt: NOW })
    expect((await call('list_reminders')).text).toContain('No open reminders')
    expect((await call('list_reminders', { status: 'done' })).text).toContain('Написать про интро')
    expect((await call('complete_reminder', { id, undo: true })).text).toContain('Reopened')
    expect((await call('complete_reminder', { id: 'нет' })).error).toBe(true)
  })

  it('does not confuse two Olegs: asks to clarify; rejects a future interaction; does not invent an unknown person', async () => {
    const { call } = await world()
    await call('add_person', { first_name: 'Олег', last_name: 'Иванов' })
    await call('add_person', { first_name: 'Олег', last_name: 'Петров' })
    const amb = await call('log_interaction', { people: ['Олег'], type: 'call' })
    expect(amb.error).toBe(true)
    expect(amb.text).toContain('several people')
    expect(amb.text).toContain('Иванов')
    expect(amb.text).toContain('Петров')
    expect((await call('log_interaction', { people: ['Олег Иванов'], type: 'call', date: '2026-12-01' })).text).toContain('in the future')
    expect((await call('log_interaction', { people: ['Марсианин'], type: 'call' })).text).toContain('Could not find')
  })

  it('update_person adds to lists, appends notes and does not duplicate', async () => {
    const { call, store } = await world()
    await call('add_person', { first_name: 'Мария', tags: ['ai'], notes: 'познакомились на форуме' })
    await call('update_person', { person: 'Мария', tags: ['ai', 'edtech'], facts: ['любит бег', 'Любит бег'], topics: ['спросить про переезд'], notes: 'ищет менторов', city: 'Лиссабон' })
    const m = store.all('people')[0]!
    expect(m.tags).toEqual(['ai', 'edtech'])
    expect(m.facts).toHaveLength(1)
    expect(m.topics).toMatchObject([{ text: 'спросить про переезд', done: false }])
    expect(m.notes).toBe('познакомились на форуме\n\n2026-10-12: ищет менторов')
    expect(m.city).toBe('Лиссабон')
    expect(m.updatedAt).toBe(NOW)
    expect((await call('update_person', { person: 'Мария' })).text).toContain('Nothing to change')
  })

  it('one owner\'s data is not visible to another', async () => {
    const { call, store, rpc } = await world()
    await call('add_person', { first_name: 'Олег' })
    expect([...store.rows.keys()][0]).toMatch(/^u1-\d+\|/)
    const other = await rpc('tools/call', { name: 'search_people', arguments: {} }, 5, OTHER)
    expect(other.status).toBe(403)
  })

  it('moving and editing a reminder; get_person assembles the card', async () => {
    const { call, store } = await world()
    await call('add_person', { first_name: 'Анна', last_name: 'Лебедь', role: 'дизайнер' })
    await call('add_reminder', { text: 'Позвонить', when: '2026-10-14T10:00', person: 'Анна' })
    const id = store.all('reminders')[0]!.id
    await call('update_reminder', { id, when: '2026-10-16T11:30', text: 'Позвонить про макет' })
    expect(store.all('reminders')[0]).toMatchObject({ text: 'Позвонить про макет', dueAt: new Date('2026-10-16T08:30:00Z').getTime() })
    const card = await call('get_person', { person: 'Анна' })
    expect(card.text).toContain('Анна Лебедь')
    expect(card.text).toContain('Позвонить про макет')
    expect((await call('get_now')).text).toContain('2026-10-12')
  })
})
