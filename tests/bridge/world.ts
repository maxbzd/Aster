import { hashToken } from '@/bridge/pairing'
import type { OwnBridge } from '@/bridge/own'
import { SCOPE_OF, SCOPES, type Connection, type FeedItem, type LinkRow, type PulledItem, type Scope } from '@/bridge/protocol'
import type { MetaStore } from '@/bridge/cycle'

/**
 * A Supabase project in memory with the same rules as in supabase/migrations/…_bridge.sql:
 * one-time codes, keys by hash, a permission filter, "the newer stamp wins", identical content does not change the number.
 */
export class Project {
  seq = 0
  offers = new Map<string, { label: string; scopes: Scope[]; expires: number }>()
  conns: Array<Connection & { inbound_hash: string | null }> = []
  feed = new Map<string, PulledItem & { scope: Scope }>()
  links = new Map<string, LinkRow>()
  now = () => Date.now()
  failNext = 0
  idn = 0
  constructor(public url: string, public key: string) {}

  /* calls with sign-in */
  own(): OwnBridge {
    const self = this
    const guard = () => { if (self.failNext > 0) { self.failNext--; throw new Error('Failed to fetch') } }
    return {
      listConnections: async () => { guard(); return self.conns.map(({ inbound_hash: _h, ...c }) => ({ ...c })) },
      listLinks: async () => { guard(); return [...self.links.values()].map(l => ({ ...l })) },
      publish: async (items: FeedItem[]) => {
        guard()
        for (const it of items) {
          const k = `${it.entity}:${it.key}`
          const cur = self.feed.get(k)
          const ms = it.updated_ms ?? self.now()
          if (cur && !(ms > cur.updated_ms)) continue
          if (cur && JSON.stringify(cur.data) === JSON.stringify(it.data) && cur.deleted === it.deleted) continue
          self.feed.set(k, { entity: it.entity, key: it.key, data: it.data, deleted: it.deleted, updated_ms: ms, seq: ++self.seq, scope: SCOPE_OF[it.entity] })
        }
      },
      putLinks: async rows => {
        guard()
        for (const r of rows) {
          const cur = self.links.get(r.local_id)
          if (cur && !(r.updated_ms > cur.updated_ms)) continue
          self.links.set(r.local_id, { ...r })
        }
      },
      createOffer: async (label, scopes) => {
        guard()
        const code = `bo_${(++self.idn).toString(16).padStart(48, 'a')}`
        const expires = self.now() + 10 * 60_000
        self.offers.set(await hashToken(code), { label, scopes, expires })
        return { code, expiresAt: new Date(expires).toISOString() }
      },
      register: async (hash, scopes) => {
        guard()
        const id = `c${++self.idn}`
        self.conns.push({ id, peer_label: '', scopes, peer_url: null, peer_key: null, outbound_token: null, created_at: '', last_read_at: null, inbound_hash: hash })
        return id
      },
      complete: async (id, c) => {
        guard()
        const row = self.conns.find(x => x.id === id)
        if (!row) throw new Error('connection not found')
        Object.assign(row, { peer_label: c.label, peer_url: c.url, peer_key: c.key, outbound_token: c.token })
      },
      disconnect: async id => { guard(); self.conns = self.conns.filter(c => c.id !== id) },
      setScopes: async (id, scopes) => { guard(); const c = self.conns.find(x => x.id === id); if (c) c.scopes = scopes },
    }
  }

  /* anonymous calls by key (what the other app's fetch does) */
  async rpc(fn: string, b: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    if (this.failNext > 0) { this.failNext--; throw new TypeError('Failed to fetch') }
    const denied = (message: string) => ({ status: 400, body: { code: '28000', message } })
    if (fn === 'bridge_accept') {
      const h = await hashToken(String(b.p_code))
      const o = this.offers.get(h)
      if (!o || o.expires < this.now()) return denied('invalid code')
      this.offers.delete(h)
      const token = `bt_${(++this.idn).toString(16).padStart(64, 'b')}`
      this.conns.push({ id: `c${++this.idn}`, peer_label: String(b.p_label), scopes: o.scopes, peer_url: String(b.p_peer_url), peer_key: String(b.p_peer_key), outbound_token: String(b.p_peer_token), created_at: '', last_read_at: null, inbound_hash: await hashToken(token) })
      return { status: 200, body: { token, label: o.label, scopes: o.scopes } }
    }
    if (fn === 'bridge_pull') {
      const h = await hashToken(String(b.p_token))
      const c = this.conns.find(x => x.inbound_hash === h)
      if (!c) return denied('invalid token')
      c.last_read_at = new Date(this.now()).toISOString()
      const rows = [...this.feed.values()].filter(r => r.seq > Number(b.p_after ?? 0) && c.scopes.includes(r.scope)).sort((a, z) => a.seq - z.seq).slice(0, Number(b.p_limit ?? 200))
      return { status: 200, body: { rows: rows.map(({ scope: _s, ...r }) => r), next: rows.at(-1)?.seq ?? null } }
    }
    if (fn === 'bridge_drop') {
      const h = await hashToken(String(b.p_token))
      this.conns = this.conns.filter(x => x.inbound_hash !== h)
      return { status: 200, body: null }
    }
    return { status: 404, body: { message: 'no such function' } }
  }
}

/** A fetch replacement: finds the project by the address and calls the function. */
export function worldFetch(projects: Project[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const m = /^(https:\/\/[^/]+)\/rest\/v1\/rpc\/(\w+)$/.exec(url)
    const p = projects.find(x => x.url === m?.[1])
    if (!m || !p) throw new TypeError('Failed to fetch')
    const { status, body } = await p.rpc(m[2]!, JSON.parse(String(init?.body ?? '{}')))
    return new Response(body == null ? '' : JSON.stringify(body), { status })
  }) as typeof fetch
}

export class MemoryMeta implements MetaStore {
  data = new Map<string, unknown>()
  async get<T>(k: string) { return this.data.get(k) as T | undefined }
  async set(k: string, v: unknown) { this.data.set(k, JSON.parse(JSON.stringify(v))) }
}

export const allScopes = [...SCOPES]
