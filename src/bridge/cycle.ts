import type { OwnBridge } from './own'
import { peerPull, type PeerEndpoint } from './peer'
import { BridgeError, itemKey, stable, type Connection, type FeedItem, type LinkRow, type PulledItem } from './protocol'

/** Хранилище служебного состояния моста на этом устройстве (курсоры, кэши, отпечатки опубликованного). */
export interface MetaStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

/** Связи как их видит приложение: peerId → localId и обратно, плюс явно разорванные. */
export interface LinkMap {
  /** активные связи: id у меня → id у другого */
  byLocal: Map<string, string>
  byPeer: Map<string, string>
  /** разорванные пары, которые нельзя связывать автоматически */
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
  /** связи, которые приложение хочет создать или изменить (автоматическое сопоставление, чужие связи) */
  links: LinkRow[]
  changed: number
}

/** Всё, что в мосте зависит от конкретного приложения. */
export interface BridgeAdapter {
  /** Текущее состояние всего, что приложение публикует. Исчезнувшее из списка уйдёт как удалённое. */
  collect(links: LinkMap): Promise<FeedItem[]>
  /** Применяет то, что пришло из другого приложения. Должно быть идемпотентным. */
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
/** Курсор отступает назад: запись другой стороны могла зафиксироваться позже уже прочитанных. */
const PULL_OVERLAP = 100

interface PubState { [k: string]: { fp: string; ms: number } }

/**
 * Один круг обмена: опубликовать своё, забрать чужое, применить.
 * Сеть недоступна или другая сторона отключилась — это не ошибка круга: статус виден в отчёте.
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
      // связи изменились: чужие данные могли тогда подойти к людям, с которыми раньше не связывались
      links = buildLinkMap(await d.own.listLinks())
    }
  }
  // актуальные связи нужны экранам (кто с кем связан) и работают без сети
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
    // метка растёт при каждом изменении, даже если приложение дало более раннее время
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
  // отпечатки запоминаются только после успешной отправки всех пачек
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
    // если связи поменялись, следующий круг перечитает всё с начала — чужие записи могли теперь подойти
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
