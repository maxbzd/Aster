import type { OwnBridge } from './own'
import { peerPull, type PeerEndpoint } from './peer'
import { BridgeError, itemKey, stable, type Connection, type FeedItem, type LinkRow, type PulledItem } from './protocol'

/** Storage of the bridge's bookkeeping on this device (cursors, caches, fingerprints of what was published). */
export interface MetaStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

/** Links as the app sees them: peerId → localId and back, plus the explicitly broken ones. */
export interface LinkMap {
  /** active links: my id → the other's id */
  byLocal: Map<string, string>
  byPeer: Map<string, string>
  /** broken pairs that must not be linked automatically */
  blocked: Array<{ localId: string; peerId: string }>
  rows: LinkRow[]
}

export function buildLinkMap(rows: LinkRow[]): LinkMap {
  const byLocal = new Map<string, string>()
  const byPeer = new Map<string, string>()
  const blocked: LinkMap['blocked'] = []
  for (const r of rows) {
    if (r.deleted) blocked.push({ localId: r.local_id, peerId: r.peer_id })
    else { byLocal.set(r.local_id, r.peer_id); byPeer.set(r.peer_id, r.local_id) }
  }
  return { byLocal, byPeer, blocked, rows }
}

export interface ApplyContext {
  links: LinkMap
  peerLabel: string
  meta: MetaStore
  now: number
}

export interface ApplyResult {
  /** links the app wants to create or change (automatic matching, the other side's links) */
  links: LinkRow[]
  changed: number
}

/** Everything in the bridge that depends on a specific app. */
export interface BridgeAdapter {
  /** The current state of everything the app publishes. Whatever disappears from the list goes out as deleted. */
  collect(links: LinkMap): Promise<FeedItem[]>
  /** Applies what came from the other app. Must be idempotent. */
  apply(rows: PulledItem[], ctx: ApplyContext): Promise<ApplyResult>
}

export interface CycleDeps {
  own: OwnBridge
  adapter: BridgeAdapter
  meta: MetaStore
  now?: () => number
  fetchImpl?: typeof fetch
}

export type PeerStatus = 'ok' | 'revoked' | 'offline' | 'error'
export interface CycleReport {
  published: number
  pulled: number
  changed: number
  linksChanged: number
  peers: Array<{ id: string; label: string; status: PeerStatus; error?: string }>
}

const PUBLISH_CHUNK = 200
const PULL_PAGE = 200
/** The cursor steps back: a record of the other side may have been committed later than ones already read. */
const PULL_OVERLAP = 100

interface PubState { [k: string]: { fp: string; ms: number } }

/**
 * One exchange round: publish yours, fetch the other's, apply.
 * An unreachable network or a disconnected other side is not a round error: the status is visible in the report.
 */
export async function bridgeCycle(d: CycleDeps): Promise<CycleReport> {
  const now = d.now ?? Date.now
  const report: CycleReport = { published: 0, pulled: 0, changed: 0, linksChanged: 0, peers: [] }

  const conns = (await d.own.listConnections()).filter(c => c.outbound_token && c.peer_url && c.peer_key)
  if (!conns.length) return report

  const rows = await d.own.listLinks()
  let links = buildLinkMap(rows)

  report.published = await publish(d, links, now())

  for (const c of conns) {
    const status = await pullFrom(d, c, links, now, report)
    report.peers.push({ id: c.id, label: c.peer_label, ...status })
    if (report.linksChanged) {
      // links changed: the other side's data may now fit people that were not linked before
      links = buildLinkMap(await d.own.listLinks())
    }
  }
  // current links are needed by the screens (who is linked to whom) and work offline
  await d.meta.set('links', await d.own.listLinks())
  return report
}

async function publish(d: CycleDeps, links: LinkMap, at: number): Promise<number> {
  const items = await d.adapter.collect(links)
  const prev = (await d.meta.get<PubState>('pub')) ?? {}
  const next: PubState = {}
  const out: FeedItem[] = []
  for (const it of items) {
    const k = itemKey(it.entity, it.key)
    const fp = stable({ d: it.data, x: it.deleted })
    const p = prev[k]
    if (p && p.fp === fp) { next[k] = p; continue }
    // the stamp grows with every change, even if the app gave an earlier time
    const ms = Math.max(it.updated_ms ?? at, (p?.ms ?? 0) + 1)
    next[k] = { fp, ms }
    out.push({ ...it, updated_ms: ms })
  }
  for (const [k, p] of Object.entries(prev)) {
    if (next[k]) continue
    const [entity, ...rest] = k.split(':')
    out.push({ entity: entity as FeedItem['entity'], key: rest.join(':'), data: null, deleted: true, updated_ms: Math.max(at, p.ms + 1) })
  }
  for (let i = 0; i < out.length; i += PUBLISH_CHUNK) await d.own.publish(out.slice(i, i + PUBLISH_CHUNK))
  // fingerprints are remembered only after all batches were sent successfully
  await d.meta.set('pub', next)
  return out.length
}

async function pullFrom(d: CycleDeps, c: Connection, links: LinkMap, now: () => number, report: CycleReport): Promise<{ status: PeerStatus; error?: string }> {
  const ep: PeerEndpoint = { url: c.peer_url!, key: c.peer_key! }
  const cursorKey = `cursor:${c.id}`
  const cursor = (await d.meta.get<number>(cursorKey)) ?? 0
  let pos = Math.max(0, cursor - PULL_OVERLAP)
  let max = cursor
  try {
    for (;;) {
      const page = await peerPull(ep, c.outbound_token!, pos, PULL_PAGE, d.fetchImpl)
      if (!page.rows.length) break
      report.pulled += page.rows.length
      const res = await d.adapter.apply(page.rows, { links, peerLabel: c.peer_label, meta: d.meta, now: now() })
      report.changed += res.changed
      if (res.links.length) {
        await d.own.putLinks(res.links)
        report.linksChanged += res.links.length
      }
      pos = page.rows[page.rows.length - 1]!.seq
      max = Math.max(max, pos)
      if (page.rows.length < PULL_PAGE) break
    }
    // if links changed, the next round re-reads everything from the start: the other side's records may fit now
    await d.meta.set(cursorKey, report.linksChanged ? 0 : max)
    return { status: 'ok' }
  } catch (e) {
    if (e instanceof BridgeError) {
      if (e.kind === 'revoked') return { status: 'revoked', error: e.message }
      if (e.kind === 'offline') return { status: 'offline' }
      return { status: 'error', error: e.message }
    }
    return { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}
