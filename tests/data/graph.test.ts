import { describe, expect, it } from 'vitest'
import { analyzeGraph, betweenness, buildEdges, detectClusters, layoutGraph } from '@/data/graph'
import { weakTies } from '@/data/weak'
import { DAY } from '@/lib/format'
import { interaction, NOW, person } from '../helpers'

const link = (to: string) => ({ personId: to, label: 'знакомы' })

/** Two companies of 3 people each and one "bridge" between them. */
const world = () => [
  person({ id: 'a1', firstName: 'Анна', links: [link('a2'), link('a3')], company: 'Акме' }),
  person({ id: 'a2', firstName: 'Антон', links: [link('a3')], company: 'Акме' }),
  person({ id: 'a3', firstName: 'Алиса', links: [], company: 'Акме' }),
  person({ id: 'b1', firstName: 'Борис', links: [link('b2'), link('b3')], company: 'Бета' }),
  person({ id: 'b2', firstName: 'Богдан', links: [link('b3')], company: 'Бета' }),
  person({ id: 'b3', firstName: 'Белла', links: [], company: 'Бета' }),
  person({ id: 'm', firstName: 'Мария', links: [link('a1'), link('b1')], company: 'Фонд' }),
  person({ id: 'solo', firstName: 'Сергей', links: [] }),
]

describe('connection graph', () => {
  it('builds edges from links, "who introduced", acquaintances and shared meetings; makes no duplicates', () => {
    const ps = [
      person({ id: 'a', links: [link('b')] }),
      person({ id: 'b', links: [link('a')], introducedBy: 'c' }),
      person({ id: 'c' }),
      person({ id: 'd' }),
    ]
    const intro = { id: 'i', aId: 'c', bId: 'd', reason: '', status: 'done' as const, createdAt: 1, updatedAt: 1 }
    const e = buildEdges(ps, [intro], [interaction({ personIds: ['a', 'd'], type: 'event' })])
    const keys = e.map(x => `${x.a}${x.b}`).sort()
    expect(keys).toEqual(['ab', 'ad', 'bc', 'cd'])
    expect(e.find(x => x.a === 'a' && x.b === 'b')?.kinds).toEqual(['link'])
  })

  it('shared meetings count only for small groups: at a big event not everyone knows each other', () => {
    const ps = Array.from({ length: 9 }, (_, i) => person({ id: `p${i}` }))
    const e = buildEdges(ps, [], [interaction({ personIds: ps.map(p => p.id), type: 'event' })])
    expect(e).toHaveLength(0)
  })

  it('splits into groups by links', () => {
    const g = analyzeGraph(world())
    const cluster = (id: string) => g.clusterOf.get(id)
    expect(cluster('a1')).toBe(cluster('a2'))
    expect(cluster('a2')).toBe(cluster('a3'))
    expect(cluster('b1')).toBe(cluster('b2'))
    expect(cluster('a1')).not.toBe(cluster('b1'))
    expect(g.isolated.map(p => p.id)).toEqual(['solo'])
  })

  it('a bridge is the one who connects groups, and they are first', () => {
    const g = analyzeGraph(world())
    expect(g.bridges[0]?.person.id).toBe('m')
    expect(g.bridges[0]?.clusters.length).toBeGreaterThanOrEqual(2)
    expect(g.bridges.map(b => b.person.id)).not.toContain('a3')
  })

  it('betweenness: the centre of a chain has the maximum, the ends zero', () => {
    const ps = ['x', 'y', 'z'].map(id => person({ id }))
    const b = betweenness(['x', 'y', 'z'], [{ a: 'x', b: 'y', w: 1, kinds: ['link'] }, { a: 'y', b: 'z', w: 1, kinds: ['link'] }])
    expect(b.get('y')).toBe(1)
    expect(b.get('x')).toBe(0)
    expect(ps).toHaveLength(3)
  })

  it('groups are named after the shared circle, or after the company if there is none', () => {
    const ps = world().map(p => (p.id.startsWith('a') ? { ...p, circleIds: ['c1'] } : p))
    const g = analyzeGraph(ps, [], [], id => (id === 'c1' ? 'Друзья' : undefined))
    const names = g.clusters.map(c => c.name)
    expect(names).toContain('Друзья')
    expect(names).toContain('Бета')
  })

  it('group numbers start from the biggest; the result is the same in any order of people', () => {
    const w = world()
    const a = detectClusters(w.map(p => p.id), buildEdges(w))
    const shuffled = [...w].reverse()
    const b = detectClusters(shuffled.map(p => p.id), buildEdges(shuffled))
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
  })

  it('the layout fits everyone into the frame and is deterministic', () => {
    const w = world()
    const g = analyzeGraph(w)
    const ids = g.connected.map(p => p.id)
    const l1 = layoutGraph(ids, g.edges, g.clusterOf, 360, 420)
    const l2 = layoutGraph(ids, g.edges, g.clusterOf, 360, 420)
    expect([...l1.entries()]).toEqual([...l2.entries()])
    for (const { x, y } of l1.values()) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(360)
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(420)
    }
    // members of one group are closer to each other than to an outsider
    const d = (a: string, b: string) => Math.hypot(l1.get(a)!.x - l1.get(b)!.x, l1.get(a)!.y - l1.get(b)!.y)
    expect(d('a2', 'a3')).toBeLessThan(d('a2', 'b2'))
  })

  it('an empty and a single-node graph do not break', () => {
    expect(layoutGraph([], [], new Map(), 300, 300).size).toBe(0)
    expect(layoutGraph(['x'], [], new Map(), 300, 300).get('x')).toEqual({ x: 150, y: 150 })
    expect(analyzeGraph([]).clusters).toEqual([])
  })

  it('family and archived people do not take part in the graph', () => {
    const g = analyzeGraph([person({ id: 'a', links: [link('f')] }), person({ id: 'f', familyOf: 'a' }), person({ id: 'z', archived: true, links: [link('a')] })])
    expect(g.edges).toHaveLength(0)
  })
})

describe('weak ties', () => {
  const at = (d: number) => NOW - d * DAY
  it('the list holds distant acquaintances with potential; close ones and people with a status are not included', () => {
    const ps = [
      ...world().map(p => ({ ...p, closeness: 3 as const, lastContactAt: at(200) })),
      person({ id: 'near', closeness: 1, links: [link('a3')] }),
      person({ id: 'quiet', closeness: 3, lifeStatus: 'paused', links: [link('b3')] }),
    ]
    const g = analyzeGraph(ps)
    const list = weakTies(ps, [], g, NOW)
    expect(list.map(x => x.person.id)).toContain('m')
    expect(list.map(x => x.person.id)).not.toContain('near')
    expect(list.map(x => x.person.id)).not.toContain('quiet')
    expect(list.find(x => x.person.id === 'm')?.reasons.join(' ')).toMatch(/Мост между мирами|разных групп/)
    expect(list[0]?.score).toBeGreaterThanOrEqual(list.at(-1)!.score)
  })

  it('accounts for a rare city, an influential role and a long silence, and explains it in words', () => {
    const ps = [
      person({ id: 'a', closeness: 4, city: 'Дубай', role: 'Managing Partner', canHelpMe: 'интро к фондам', lastContactAt: at(300) }),
      person({ id: 'b', closeness: 4, city: 'Москва' }),
      person({ id: 'c', closeness: 4, city: 'Москва' }),
      person({ id: 'd', closeness: 4, city: 'Москва' }),
    ]
    const [top] = weakTies(ps, [], analyzeGraph(ps), NOW)
    expect(top?.person.id).toBe('a')
    const text = top!.reasons.join(' | ')
    expect(text).toMatch(/Дубай/)
    expect(text).toMatch(/помочь|Роль/)
    expect(top!.score).toBeGreaterThan(40)
  })

  it('an "almost close" person with no contact in a year also counts as a weak tie, one with regular contact does not', () => {
    const base = person({ id: 'x', closeness: 2, city: 'Тбилиси', role: 'CEO', canHelpMe: 'интро', lastContactAt: at(250) })
    const regular = person({ id: 'y', closeness: 2, city: 'Тбилиси', role: 'CEO', canHelpMe: 'интро', lastContactAt: at(5) })
    const ints = [at(5), at(40), at(80), at(120)].map(d => interaction({ personIds: ['y'], date: d }))
    const ids = weakTies([base, regular], ints, analyzeGraph([base, regular], [], ints), NOW).map(x => x.person.id)
    expect(ids).toContain('x')
    expect(ids).not.toContain('y')
  })
})
