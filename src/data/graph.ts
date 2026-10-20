import type { ID, Interaction, Intro, Person } from './types'
import { t } from '@/i18n'

/** Кто кого знает: явные связи из профиля, знакомства через тебя, «кто познакомил», совместные встречи. */
export type EdgeKind = 'link' | 'intro' | 'introducedBy' | 'together'

export interface GraphEdge { a: ID; b: ID; w: number; kinds: EdgeKind[] }

const WEIGHT: Record<EdgeKind, number> = { link: 3, intro: 3, introducedBy: 2, together: 1 }

const pairKey = (a: ID, b: ID) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function buildEdges(people: Person[], intros: Intro[] = [], ints: Interaction[] = []): GraphEdge[] {
  const ids = new Set(people.map(p => p.id))
  const map = new Map<string, GraphEdge>()
  const add = (a: ID, b: ID, kind: EdgeKind, w = WEIGHT[kind]) => {
    if (a === b || !ids.has(a) || !ids.has(b)) return
    const k = pairKey(a, b)
    const e = map.get(k) ?? { a: a < b ? a : b, b: a < b ? b : a, w: 0, kinds: [] }
    if (!e.kinds.includes(kind)) { e.kinds.push(kind); e.w += w }
    map.set(k, e)
  }
  for (const p of people) {
    for (const l of p.links) add(p.id, l.personId, 'link')
    if (p.introducedBy) add(p.id, p.introducedBy, 'introducedBy')
  }
  for (const i of intros) if (i.status === 'done') add(i.aId, i.bId, 'intro')
  // были на одной встрече: слабая, но настоящая связь (большие события не считаем — там знакомы все со всеми)
  for (const i of ints) {
    if (i.personIds.length < 2 || i.personIds.length > 6) continue
    for (let x = 0; x < i.personIds.length; x++) for (let y = x + 1; y < i.personIds.length; y++) add(i.personIds[x]!, i.personIds[y]!, 'together')
  }
  return [...map.values()]
}

/** Группы: взвешенное распространение меток — каждый переходит в ту группу, где у него больше всего связей. */
export function detectClusters(nodeIds: ID[], edges: GraphEdge[]): Map<ID, number> {
  const ids = [...nodeIds].sort()
  const nb = new Map<ID, Array<[ID, number]>>(ids.map(i => [i, []]))
  for (const e of edges) { nb.get(e.a)?.push([e.b, e.w]); nb.get(e.b)?.push([e.a, e.w]) }
  const label = new Map<ID, number>(ids.map((i, k) => [i, k]))
  for (let round = 0; round < 30; round++) {
    let changed = false
    for (const id of ids) {
      const score = new Map<number, number>()
      for (const [n, w] of nb.get(id)!) score.set(label.get(n)!, (score.get(label.get(n)!) ?? 0) + w)
      if (!score.size) continue
      let best = label.get(id)!
      let bestScore = score.get(best) ?? 0
      for (const [l, s] of [...score.entries()].sort((a, b) => a[0] - b[0])) if (s > bestScore) { best = l; bestScore = s }
      if (best !== label.get(id)) { label.set(id, best); changed = true }
    }
    if (!changed) break
  }
  // номера по размеру: самая большая группа — 0
  const sizes = new Map<number, number>()
  for (const l of label.values()) sizes.set(l, (sizes.get(l) ?? 0) + 1)
  const order = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([l]) => l)
  const renum = new Map(order.map((l, i) => [l, i]))
  return new Map([...label.entries()].map(([id, l]) => [id, renum.get(l)!]))
}

/** Посредничество (алгоритм Брандеса): через кого проходит больше всего кратчайших путей между другими людьми. */
export function betweenness(nodeIds: ID[], edges: GraphEdge[]): Map<ID, number> {
  const nb = new Map<ID, ID[]>(nodeIds.map(i => [i, []]))
  for (const e of edges) { nb.get(e.a)?.push(e.b); nb.get(e.b)?.push(e.a) }
  const cb = new Map<ID, number>(nodeIds.map(i => [i, 0]))
  for (const s of nodeIds) {
    const stack: ID[] = []
    const pred = new Map<ID, ID[]>(nodeIds.map(i => [i, []]))
    const sigma = new Map<ID, number>(nodeIds.map(i => [i, 0]))
    const dist = new Map<ID, number>(nodeIds.map(i => [i, -1]))
    sigma.set(s, 1); dist.set(s, 0)
    const q: ID[] = [s]
    for (let h = 0; h < q.length; h++) {
      const v = q[h]!
      stack.push(v)
      for (const w of nb.get(v)!) {
        if (dist.get(w)! < 0) { dist.set(w, dist.get(v)! + 1); q.push(w) }
        if (dist.get(w) === dist.get(v)! + 1) { sigma.set(w, sigma.get(w)! + sigma.get(v)!); pred.get(w)!.push(v) }
      }
    }
    const delta = new Map<ID, number>(nodeIds.map(i => [i, 0]))
    while (stack.length) {
      const w = stack.pop()!
      for (const v of pred.get(w)!) delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!))
      if (w !== s) cb.set(w, cb.get(w)! + delta.get(w)!)
    }
  }
  // каждая пара посчитана дважды (неориентированный граф)
  return new Map([...cb.entries()].map(([k, v]) => [k, v / 2]))
}

export interface Cluster { id: number; members: Person[]; name: string }
export interface Bridge { person: Person; score: number; /** номера групп, которые он соединяет */ clusters: number[]; degree: number }

export interface GraphAnalysis {
  edges: GraphEdge[]
  clusters: Cluster[]
  clusterOf: Map<ID, number>
  bridges: Bridge[]
  degree: Map<ID, number>
  /** люди, про чьи связи ничего не известно */
  isolated: Person[]
  /** люди на графе (есть хотя бы одна связь) */
  connected: Person[]
}

const topShare = (members: Person[], pick: (p: Person) => string | undefined): string | null => {
  const counts = new Map<string, number>()
  for (const p of members) { const v = pick(p)?.trim(); if (v) counts.set(v, (counts.get(v) ?? 0) + 1) }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return best && best[1] >= Math.max(2, Math.ceil(members.length * 0.5)) ? best[0] : null
}

/** Название группы: общий круг, компания или город; если ничего общего — по самому «связанному» человеку. */
export function nameCluster(members: Person[], circleName: (id: ID) => string | undefined, degree: Map<ID, number>, n: number): string {
  const circles = new Map<ID, number>()
  for (const p of members) for (const c of p.circleIds) circles.set(c, (circles.get(c) ?? 0) + 1)
  const [topCircle] = [...circles.entries()].sort((a, b) => b[1] - a[1])
  if (topCircle && topCircle[1] >= Math.max(2, Math.ceil(members.length * 0.5))) { const nm = circleName(topCircle[0]); if (nm) return nm }
  const company = topShare(members, p => p.company)
  if (company) return company
  const city = topShare(members, p => p.city)
  if (city) return city
  const hub = [...members].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0]
  return hub ? t("{firstName}'s circle", { firstName: hub.firstName }) : t('Group {v}', { v: n + 1 })
}

export function analyzeGraph(people: Person[], intros: Intro[] = [], ints: Interaction[] = [], circleName: (id: ID) => string | undefined = () => undefined): GraphAnalysis {
  const net = people.filter(p => !p.archived && !p.familyOf)
  const edges = buildEdges(net, intros, ints)
  const degree = new Map<ID, number>(net.map(p => [p.id, 0]))
  for (const e of edges) { degree.set(e.a, degree.get(e.a)! + 1); degree.set(e.b, degree.get(e.b)! + 1) }
  const connected = net.filter(p => degree.get(p.id)! > 0)
  const isolated = net.filter(p => degree.get(p.id) === 0)
  const nodeIds = connected.map(p => p.id)
  const clusterOf = detectClusters(nodeIds, edges)
  const byId = new Map(net.map(p => [p.id, p]))

  const groups = new Map<number, Person[]>()
  for (const p of connected) groups.set(clusterOf.get(p.id)!, [...(groups.get(clusterOf.get(p.id)!) ?? []), p])
  const clusters: Cluster[] = [...groups.entries()].sort((a, b) => a[0] - b[0])
    .map(([id, members]) => ({ id, members, name: nameCluster(members, circleName, degree, id) }))
  // одинаковые названия («Работа» дважды) различаем по самому связанному человеку группы
  const seen = new Map<string, number>()
  for (const c of clusters) seen.set(c.name, (seen.get(c.name) ?? 0) + 1)
  for (const c of clusters) {
    if ((seen.get(c.name) ?? 0) > 1) {
      const hub = [...c.members].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0]
      if (hub) c.name = `${c.name} · ${hub.firstName}`
    }
  }

  const bt = betweenness(nodeIds, edges)
  const max = Math.max(0, ...bt.values())
  const neighborClusters = new Map<ID, Set<number>>(nodeIds.map(i => [i, new Set([clusterOf.get(i)!])]))
  for (const e of edges) { neighborClusters.get(e.a)!.add(clusterOf.get(e.b)!); neighborClusters.get(e.b)!.add(clusterOf.get(e.a)!) }
  const bridges: Bridge[] = nodeIds
    .filter(id => (bt.get(id) ?? 0) > 0 && neighborClusters.get(id)!.size >= 2)
    .map(id => ({ person: byId.get(id)!, score: max ? bt.get(id)! / max : 0, clusters: [...neighborClusters.get(id)!].sort((a, b) => a - b), degree: degree.get(id)! }))
    .sort((a, b) => b.score - a.score || b.degree - a.degree)

  return { edges, clusters, clusterOf, bridges, degree, isolated, connected }
}

/* ---------- раскладка ---------- */

export interface LayoutNode { id: ID; x: number; y: number }

/** Простая силовая раскладка (Фрюхтерман — Рейнгольд) с притяжением к центру своей группы. Детерминирована: без случайности. */
export function layoutGraph(nodeIds: ID[], edges: GraphEdge[], clusterOf: Map<ID, number>, width: number, height: number, pad = 28): Map<ID, { x: number; y: number }> {
  const n = nodeIds.length
  const out = new Map<ID, { x: number; y: number }>()
  if (!n) return out
  if (n === 1) { out.set(nodeIds[0]!, { x: width / 2, y: height / 2 }); return out }
  const ids = [...nodeIds].sort()
  const clusterIds = [...new Set(ids.map(i => clusterOf.get(i) ?? 0))].sort((a, b) => a - b)
  const R = Math.min(width, height) * 0.28
  const center = new Map<number, { x: number; y: number }>(clusterIds.map((c, i) => {
    const a = clusterIds.length === 1 ? 0 : (i / clusterIds.length) * Math.PI * 2 - Math.PI / 2
    return [c, { x: width / 2 + (clusterIds.length === 1 ? 0 : Math.cos(a) * R), y: height / 2 + (clusterIds.length === 1 ? 0 : Math.sin(a) * R) }]
  }))
  const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0) / 4294967295 }
  const pos = new Map<ID, { x: number; y: number }>(ids.map(id => {
    const c = center.get(clusterOf.get(id) ?? 0)!
    const a = hash(id) * Math.PI * 2
    const r = 14 + hash(`${id}r`) * 26
    return [id, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }]
  }))
  const area = width * height
  const k = Math.sqrt(area / n) * 0.62
  let temp = Math.min(width, height) / 8
  for (let it = 0; it < 220; it++) {
    const disp = new Map<ID, { x: number; y: number }>(ids.map(i => [i, { x: 0, y: 0 }]))
    for (let i = 0; i < n; i++) {
      const a = pos.get(ids[i]!)!
      for (let j = i + 1; j < n; j++) {
        const b = pos.get(ids[j]!)!
        let dx = a.x - b.x; let dy = a.y - b.y
        let d = Math.hypot(dx, dy)
        if (d < 0.01) { dx = hash(ids[i]!) - 0.5; dy = hash(ids[j]!) - 0.5; d = 0.5 }
        const f = (k * k) / d
        const ux = dx / d; const uy = dy / d
        disp.get(ids[i]!)!.x += ux * f; disp.get(ids[i]!)!.y += uy * f
        disp.get(ids[j]!)!.x -= ux * f; disp.get(ids[j]!)!.y -= uy * f
      }
    }
    for (const e of edges) {
      const a = pos.get(e.a); const b = pos.get(e.b)
      if (!a || !b) continue
      const dx = a.x - b.x; const dy = a.y - b.y
      const d = Math.max(0.01, Math.hypot(dx, dy))
      const f = ((d * d) / k) * (0.5 + e.w * 0.18)
      disp.get(e.a)!.x -= (dx / d) * f; disp.get(e.a)!.y -= (dy / d) * f
      disp.get(e.b)!.x += (dx / d) * f; disp.get(e.b)!.y += (dy / d) * f
    }
    for (const id of ids) {
      const p = pos.get(id)!; const c = center.get(clusterOf.get(id) ?? 0)!
      const g = disp.get(id)!
      // группа держится вместе, весь граф — ближе к середине
      g.x += (c.x - p.x) * 0.9; g.y += (c.y - p.y) * 0.9
      g.x += (width / 2 - p.x) * 0.12; g.y += (height / 2 - p.y) * 0.12
      const len = Math.max(0.01, Math.hypot(g.x, g.y))
      const step = Math.min(len, temp)
      p.x += (g.x / len) * step; p.y += (g.y / len) * step
    }
    temp *= 0.975
  }
  // вписываем в рамку с полями
  const xs = ids.map(i => pos.get(i)!.x); const ys = ids.map(i => pos.get(i)!.y)
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys)
  const sx = (width - pad * 2) / Math.max(1, maxX - minX); const sy = (height - pad * 2) / Math.max(1, maxY - minY)
  const s = Math.min(sx, sy, 2.2)
  const ox = (width - (maxX - minX) * s) / 2 - minX * s; const oy = (height - (maxY - minY) * s) / 2 - minY * s
  for (const id of ids) { const p = pos.get(id)!; out.set(id, { x: p.x * s + ox, y: p.y * s + oy }) }
  return out
}
